#!/usr/bin/env python3
"""Cross-platform weburp lifecycle and verified headless scene screenshots."""
import argparse
import base64
import html.parser
import hashlib
import json
import ntpath
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError
import zlib
from weburp_paths import state_dir

TOOL = Path(__file__).resolve().parent


def bundled_font_status(root=TOOL):
    path = Path(root) / 'assets/fonts/NotoSansCJKsc-Regular.otf'
    expected = '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size != 16437364:
            return {'ready': False, 'reason': 'bundled-cjk-font-missing-or-invalid'}
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return {'ready': digest == expected, 'sha256': digest}
    except OSError:
        return {'ready': False, 'reason': 'bundled-cjk-font-unreadable'}


def venv_python():
    candidates = [TOOL / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')]
    return str(next((p for p in candidates if p.is_file()), Path(sys.executable)))


def start_creationflags(platform=os.name):
    flags = getattr(subprocess, 'DETACHED_PROCESS', 0) | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
    if platform == 'nt':
        flags |= 0x01000000   # detach from a parent Windows Job Object when possible
        return flags
    return 0


def load_state():
    p = state_dir() / '.state.json'
    if p.is_symlink():
        raise ValueError('state file must not be a symlink')
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def loopback_open(url, timeout=2, headers=None, data=None, method=None):
    """Talk to loopback directly and never inherit system HTTP proxy settings."""
    req = Request(url, data=data, headers=headers or {}, method=method)
    return build_opener(ProxyHandler({})).open(req, timeout=timeout)


def health(st):
    if not st or not isinstance(st.get('pid'), int) or st['pid'] < 2:
        return False
    try:
        req_headers = {'Authorization': 'Bearer ' + st['token']}
        with loopback_open('http://127.0.0.1:%d/api/health' % int(st['port']), timeout=2, headers=req_headers) as response:
            value = json.loads(response.read(4096))
        return value.get('service') == 'weburp' and value.get('pid') == st['pid'] and value.get('instance') == st.get('instance') and bool(st.get('instance'))
    except (OSError, ValueError, KeyError):
        return False


def port_busy(port):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex(('127.0.0.1', port)) == 0


def valid_port(value):
    number = int(value)
    if not 1 <= number <= 65535:
        raise ValueError('port must be in 1..65535')
    return number


def write_state(value):
    directory = state_dir()
    fd, name = tempfile.mkstemp(prefix='.state-', dir=directory)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(value, f); f.flush(); os.fsync(f.fileno())
        os.replace(name, directory / '.state.json')
    finally:
        if os.path.exists(name): os.unlink(name)


def upstream_proxy_env(environ=None):
    env = os.environ if environ is None else environ
    raw = (env.get('WEBURP_UPSTREAM_PROXY') or '').strip()
    if raw.startswith('http://127.0.0.1:') or raw.startswith('http://localhost:'):
        return raw
    return ''


def cmd_start(a):
    st = load_state()
    wanted = upstream_proxy_env()
    if health(st) and st.get('upstream_proxy', '') == wanted:
        live = int(st['port'])
        if a.port not in (None, '') and valid_port(a.port) != live:
            raise ValueError('weburp 已在端口 %d 运行（%s）；请使用该端口或先 stop' % (live, st['url']))
        if not getattr(a, 'quiet', False): print(st['url'])
        return 0
    if health(st) and st.get('upstream_proxy', '') != wanted:
        cmd_stop(argparse.Namespace())
        st = load_state()
    port = valid_port(a.port or (st or {}).get('port') or 8777)
    if port_busy(port):
        raise ValueError('端口被其他实例占用，请确认原进程或指定 --port')
    token = a.token or os.environ.get('WEBURP_TOKEN') or (st or {}).get('token') or secrets.token_urlsafe(24)
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,256}', token):
        raise ValueError('token must use URL-safe characters')
    instance = secrets.token_hex(16)
    directory = state_dir()
    env = dict(os.environ, WEBURP_TOKEN=token, WEBURP_INSTANCE_ID=instance, WEBURP_STATE_DIR=str(directory), PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
    with os.fdopen(os.open(directory / 'server.log', os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), 'ab') as log:
        child = subprocess.Popen([venv_python(), str(TOOL / 'server.py'), '--port', str(port)], cwd=TOOL,
            env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
            start_new_session=os.name != 'nt', creationflags=start_creationflags())
    value = {'port': port, 'token': token, 'pid': child.pid, 'instance': instance,
             'url': 'http://127.0.0.1:%d/repeater?token=%s' % (port, token),
             'upstream_proxy': wanted}
    for _ in range(60):
        if child.poll() is not None: break
        if health(value):
            write_state(value)
            if not getattr(a, 'quiet', False): print(value['url'])
            return 0
        time.sleep(.25)
    if child.poll() is None: child.terminate()
    raise ValueError('weburp 启动未通过健康检查；请查看私有状态目录中的 server.log')


def cmd_stop(a):
    st = load_state()
    if not st:
        print('未运行'); return 0
    if not health(st):
        raise ValueError('实例身份不匹配，保留状态文件；请核实原进程')
    if os.name == 'nt':
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(st['pid'])], check=True, capture_output=True, timeout=10)
    else:
        os.kill(st['pid'], signal.SIGTERM)
    for _ in range(40):
        if not health(st):
            if load_state() == st: (state_dir() / '.state.json').unlink()
            print('已停止'); return 0
        time.sleep(.25)
    raise ValueError('实例尚未停止，请检查进程状态')


def cmd_status(a):
    st = load_state()
    running = health(st)
    if running:
        value = {
            'ok': True,
            'running': True,
            'base_url': 'http://127.0.0.1:%d' % int(st['port']),
            'url': st['url'],
            'port': int(st['port']),
            'token': st['token'],
            'pid': st['pid'],
        }
        print(json.dumps(value, ensure_ascii=False) if getattr(a, 'json', False) else '运行中: ' + st['url'])
        return 0
    value = {'ok': False, 'running': False, 'error': '未运行或实例身份不匹配'}
    print(json.dumps(value, ensure_ascii=False) if getattr(a, 'json', False) else value['error'])
    return 1


def cmd_api(a):
    st = ensure_started()
    path = str(a.path or '')
    parsed = urlparse(path)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith('/api/'):
        raise ValueError('API path must be a local /api/... path')
    method = a.method.upper()
    if method not in ('GET', 'POST', 'DELETE'):
        raise ValueError('API method must be GET, POST, or DELETE')
    data = None
    if a.data is not None:
        data = a.data.encode('utf-8')
    elif a.data_file:
        data = Path(a.data_file).read_bytes()
    headers = {'Authorization': 'Bearer ' + st['token']}
    if data is not None:
        headers['Content-Type'] = 'application/json; charset=utf-8'
    url = 'http://127.0.0.1:%d%s' % (int(st['port']), path)
    try:
        with loopback_open(url, timeout=a.timeout, headers=headers, data=data, method=method) as response:
            body = response.read()
            status = response.status
    except HTTPError as error:
        body = error.read()
        status = error.code
    text = body.decode('utf-8', 'replace')
    if not a.raw:
        try:
            text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except ValueError:
            pass
    print(text)
    return 0 if 200 <= status < 300 else 1


def find_chrome(platform=None, environ=None, which=None, usable=None):
    platform = platform or sys.platform
    environ = os.environ if environ is None else environ
    which = which or shutil.which
    usable = usable or (lambda p: Path(p).is_file() and os.access(p, os.X_OK))
    configured = environ.get('WEBURP_BROWSER') or environ.get('CHROME_BIN')
    if configured:
        path = which(configured) or configured
        if usable(path): return path
        raise ValueError('WEBURP_BROWSER / CHROME_BIN 路径不存在或不可执行')
    candidates = []
    if platform == 'darwin':
        candidates += ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    elif platform == 'win32':
        for base in [environ.get('PROGRAMFILES', r'C:\Program Files'), environ.get('PROGRAMFILES(X86)', r'C:\Program Files (x86)'), environ.get('LOCALAPPDATA', '')]:
            if base:
                candidates += [ntpath.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), ntpath.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    candidates += [which(name) for name in ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'chrome', 'msedge']]
    for path in candidates:
        if path and usable(path): return path
    raise ValueError('未找到 Chrome、Edge 或 Chromium；请安装浏览器或设置 WEBURP_BROWSER')


def scene_url(value):
    u = urlparse(value)
    if len(value) > 16384 or u.scheme not in ('http', 'https') or u.hostname not in ('127.0.0.1', 'localhost') or u.username or u.password:
        raise ValueError('截图仅接受本机 weburp 场景 URL')
    valid_port(u.port or (443 if u.scheme == 'https' else 80))
    if u.path not in ('/repeater', '/terminal'):
        raise ValueError('截图页面必须是 /repeater 或 /terminal')
    q = parse_qs(u.query)
    if q.get('scene') and re.fullmatch(r'[A-Za-z0-9_-]+', q['scene'][0]): return u
    if u.path == '/terminal' and re.fullmatch(r'd=[A-Za-z0-9_-]+', u.fragment): return u
    raise ValueError('请提供已创建场景的 scene 参数')


class ReadyParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.ready = False
    def handle_starttag(self, tag, attrs):
        if tag == 'html': self.ready = dict(attrs).get('data-weburp-ready') == '1'


def validate_png(path, width, height):
    data = Path(path).read_bytes()
    if len(data) > 64 * 1024 * 1024 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('截图不是有效 PNG')
    at = 8; saw_header = saw_data = False
    while at + 12 <= len(data):
        size = struct.unpack('>I', data[at:at+4])[0]; kind = data[at+4:at+8]; end = at + 12 + size
        if end > len(data): break
        body = data[at+8:at+8+size]
        if zlib.crc32(kind + body) & 0xffffffff != struct.unpack('>I', data[at+8+size:end])[0]: break
        if kind == b'IHDR':
            if saw_header or at != 8 or size != 13 or struct.unpack('>II', body[:8]) != (width, height): break
            saw_header = True
        if kind == b'IDAT': saw_data = True
        if kind == b'IEND' and size == 0 and end == len(data) and saw_header and saw_data: return len(data)
        at = end
    raise ValueError('PNG 内容不完整或尺寸不符')


def chrome_proxy_args(environ=None):
    """Keep loopback capture direct; optionally proxy only non-local navigation."""
    env = environ if environ is not None else os.environ
    args = ['--proxy-bypass-list=127.0.0.1;localhost;::1;[::1]']
    raw = (env.get('WEBURP_UPSTREAM_PROXY') or env.get('ALL_PROXY') or env.get('all_proxy') or '').strip()
    if raw.startswith('http://127.0.0.1:') or raw.startswith('http://localhost:'):
        args.insert(0, '--proxy-server=' + raw)
    return args


def kill_shot_processes(pid, profile_dir):
    if os.name == 'nt':
        if pid:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(pid)], capture_output=True, timeout=10)
        return
    if pid:
        try: os.killpg(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError): pass
    marker = str(profile_dir)
    if not marker or '.weburp-shot-' not in marker.replace('\\', '/'):
        return
    try:
        listed = subprocess.run(['pgrep', '-f', marker], capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return
    for line in listed.stdout.split():
        try: os.kill(int(line), signal.SIGTERM)
        except (ValueError, ProcessLookupError, PermissionError, OSError): pass


def cmd_shot(a):
    parsed = scene_url(a.url)
    live = load_state()
    if health(live):
        url_port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        if int(live['port']) != url_port:
            raise ValueError('截图 URL 端口 %s 与运行中的 weburp %s 不一致；请重新 capture 或先 stop' % (url_port, live['port']))
    m = re.fullmatch(r'(\d{2,4})x(\d{2,4})', a.size)
    if not m: raise ValueError('size 应为 宽x高')
    width, height = map(int, m.groups())
    if not 64 <= width <= 4096 or not 64 <= height <= 4096 or not 0 <= a.budget <= 60000:
        raise ValueError('尺寸范围 64..4096，budget 范围 0..60000')
    browser = find_chrome()
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        raise ValueError('请以普通服务账号截图，例如 runuser -u swarm -- python3 ...；保持浏览器沙箱启用')
    out = Path(a.out).expanduser().absolute()
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.weburp-shot-', dir=out.parent) as directory:
        shot = Path(directory) / 'capture.png'
        cmd = [browser, '--headless=new', '--disable-gpu', '--lang=zh-CN', '--no-first-run', '--no-default-browser-check',
            '--disable-background-networking', '--disable-dev-shm-usage', '--force-device-scale-factor=1',
            '--user-data-dir=' + str(Path(directory) / 'profile'), '--window-size=%d,%d' % (width, height),
            '--virtual-time-budget=%d' % a.budget, '--timeout=60000', '--dump-dom'] + chrome_proxy_args() + [
            '--screenshot=' + str(shot), a.url]
        # Chrome helpers on macOS may outlive completed CLI capture. Completion is
        # the fresh, CRC-checked PNG plus the page's successful ready marker, not
        # pipe EOF. File-backed streams also bound memory for large scene DOMs.
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            child = subprocess.Popen(cmd, stdout=stdout, stderr=stderr, start_new_session=os.name != 'nt')
            deadline = time.monotonic() + 120
            try:
                while True:
                    code = child.poll()
                    if code not in (None, 0):
                        stderr.seek(max(0, stderr.seek(0, 2) - 700))
                        error = stderr.read().decode('utf-8', 'replace')
                        for token in parse_qs(urlparse(a.url).query).get('token', []): error = error.replace(token, '[redacted]')
                        raise ValueError('浏览器退出码 %d: %s' % (code, error))
                    stdout.seek(0); parser = ReadyParser(); parser.feed(stdout.read(1024 * 1024).decode('utf-8', 'replace'))
                    complete = False
                    if parser.ready and shot.is_file():
                        try: validate_png(shot, width, height); complete = True
                        except ValueError: pass  # Chromium may still be writing the final chunks.
                    if complete: break
                    if code == 0: raise ValueError('场景尚未就绪或加载失败；原图片保留')
                    if time.monotonic() >= deadline: raise ValueError('浏览器截图超时，原图片保留')
                    time.sleep(0.1)
            finally:
                kill_shot_processes(child.pid, Path(directory) / 'profile')
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name != 'nt':
                        try: os.killpg(child.pid, signal.SIGKILL)
                        except (ProcessLookupError, PermissionError, OSError): pass
                    kill_shot_processes(child.pid, Path(directory) / 'profile')
                    child.wait(timeout=5)
        os.replace(shot, out)
    print(str(out)); return 0


def cmd_migrate(a):
    source = Path(a.source).resolve()
    destination = state_dir()
    if source == destination.resolve():
        print('SCENES_ALREADY_IN_STATE_DIR'); return 0
    plans = []; copied = skipped = 0
    for p in source.glob('*.json'):
        if p.name.startswith('.') or not re.fullmatch(r'[A-Za-z0-9_-]+', p.stem): continue
        if p.is_symlink() or not p.is_file(): raise ValueError('场景源文件必须是普通文件')
        data = p.read_bytes(); value = json.loads(data)
        if not isinstance(value, dict) or value.get('id') != p.stem: raise ValueError('场景编号与文件名不一致')
        target = destination / p.name
        if target.exists():
            if target.is_symlink() or target.read_bytes() != data: raise ValueError('目标场景存在不同内容，保留原文件：' + p.name)
            skipped += 1
        else: plans.append((target, data))
    for target, data in plans:
        fd, temporary = tempfile.mkstemp(prefix='.scene-', dir=destination)
        try:
            with os.fdopen(fd, 'wb') as f: f.write(data)
            os.replace(temporary, target); copied += 1
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    previous = source / '.state.json'
    if previous.is_file() and not previous.is_symlink() and not (destination / '.state.json').exists():
        old = json.loads(previous.read_text(encoding='utf-8'))
        token = old.get('token')
        if isinstance(token, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,256}', token):
            write_state({'port': valid_port(old.get('port', 8777)), 'token': token})
    print(json.dumps({'result': 'WEBURP_SCENES_MIGRATED', 'copied': copied, 'unchanged': skipped}, ensure_ascii=False)); return 0


def ensure_started():
    st = load_state()
    wanted = upstream_proxy_env()
    if health(st) and st.get('upstream_proxy', '') != wanted:
        cmd_stop(argparse.Namespace())
        st = load_state()
    if health(st):
        return st
    class Args:
        port = None
        token = None
        quiet = True
    cmd_start(Args())
    st = load_state()
    if not health(st):
        raise ValueError('weburp 未能启动；请查看状态目录中的 server.log')
    return st


def parse_terminal_entry(value):
    parts = str(value).split('|||')
    if len(parts) < 3:
        raise ValueError('--entry 格式为 cwd|||cmd|||output 或 cwd|||cmd|||output|||exit')
    cwd, cmd, output = parts[0], parts[1], parts[2]
    exit_code = int(parts[3]) if len(parts) > 3 and parts[3] != '' else 0
    return {'cwd': cwd, 'cmd': cmd, 'output': output, 'exit': exit_code}


def post_scene(st, scene):
    body = json.dumps(scene, ensure_ascii=False).encode('utf-8')
    url = 'http://127.0.0.1:%d/api/scene?token=%s' % (int(st['port']), st['token'])
    with loopback_open(url, timeout=15, headers={'Content-Type': 'application/json'}, data=body, method='POST') as response:
        value = json.loads(response.read().decode('utf-8'))
    if not value.get('ok') or not value.get('id'):
        raise ValueError('创建场景失败：%s' % (value.get('error') or value))
    return value['id']


def cmd_capture(a):
    st = ensure_started()
    ai = []
    if a.ai_action:
        ai.append({'kind': 'action', 'text': a.ai_action})
    if a.ai_note:
        ai.append({'text': a.ai_note})
    if a.ai_success:
        ai.append({'kind': 'success', 'text': a.ai_success})
    if a.kind == 'repeater':
        if not a.request:
            raise ValueError('repeater 截图需要 --request 请求文件')
        scene = {
            'type': 'repeater',
            'name': a.name or Path(a.request).stem,
            'view': 'raw',
            'request_b64': base64.b64encode(Path(a.request).read_bytes()).decode('ascii'),
        }
        if a.response:
            scene['response_b64'] = base64.b64encode(Path(a.response).read_bytes()).decode('ascii')
        if a.host:
            scene['target'] = {'host': a.host, 'port': int(a.port or 80), 'tls': bool(a.tls)}
        if ai:
            scene['ai'] = ai
        sid = post_scene(st, scene)
        page = 'repeater'
        extra = '' if a.response else '&send=1'
    elif a.kind == 'terminal':
        entries = []
        if a.entries_file:
            raw = json.loads(Path(a.entries_file).read_text(encoding='utf-8'))
            if not isinstance(raw, list):
                raise ValueError('--entries-file 必须是 JSON 数组')
            entries = raw
        for item in (a.entry or []):
            entries.append(parse_terminal_entry(item))
        if not entries:
            raise ValueError('terminal 截图需要 --entry 或 --entries-file')
        scene = {'type': 'terminal', 'shell': a.shell or 'cmd', 'banner': True, 'entries': entries}
        if ai:
            scene['ai'] = ai
        sid = post_scene(st, scene)
        page = 'terminal'
        extra = '&cursor=0'
    else:
        raise ValueError('kind 必须是 repeater 或 terminal')
    url = 'http://127.0.0.1:%d/%s?scene=%s&token=%s&zoom=%s%s' % (
        int(st['port']), page, sid, st['token'], a.zoom or '1.6', extra)
    size = a.size or ('1100x650' if a.kind == 'terminal' else '1920x1080')
    return cmd_shot(argparse.Namespace(url=url, out=a.out, size=size, budget=a.budget if a.budget is not None else 8000))


def cmd_doctor(a):
    try:
        path = find_chrome()
    except ValueError as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False)); return 1
    p = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=10)
    font = bundled_font_status()
    ok = p.returncode == 0 and font['ready']
    print(json.dumps({'ok': ok, 'browser': path, 'version': p.stdout.strip(), 'font':font, 'encoding':'UTF-8'}, ensure_ascii=False))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(prog='weburp.py'); sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('start'); p.add_argument('--port', type=int); p.add_argument('--token'); p.set_defaults(f=cmd_start)
    sub.add_parser('stop').set_defaults(f=cmd_stop)
    p = sub.add_parser('status'); p.add_argument('--json', action='store_true'); p.set_defaults(f=cmd_status)
    p = sub.add_parser('api', help='调用已认证的本机 /api/... 接口')
    p.add_argument('method'); p.add_argument('path')
    body = p.add_mutually_exclusive_group(); body.add_argument('--data'); body.add_argument('--data-file')
    p.add_argument('--timeout', type=float, default=60); p.add_argument('--raw', action='store_true'); p.set_defaults(f=cmd_api)
    sub.add_parser('doctor').set_defaults(f=cmd_doctor)
    p = sub.add_parser('migrate-data'); p.add_argument('source'); p.set_defaults(f=cmd_migrate)
    p = sub.add_parser('shot'); p.add_argument('url'); p.add_argument('out'); p.add_argument('--size', default='1920x1080'); p.add_argument('--budget', type=int, default=8000); p.set_defaults(f=cmd_shot)
    p = sub.add_parser('capture', help='一键：启动服务 + 创建场景 + 验证截图')
    p.add_argument('kind', choices=['repeater', 'terminal'])
    p.add_argument('--out', required=True, help='输出 PNG 绝对路径')
    p.add_argument('--request', help='原始 HTTP 请求文件（repeater）')
    p.add_argument('--response', help='原始 HTTP 响应文件（repeater；省略则页面 &send=1 实发）')
    p.add_argument('--host'); p.add_argument('--port', type=int); p.add_argument('--tls', action='store_true')
    p.add_argument('--name', help='场景名')
    p.add_argument('--shell', default='cmd', help='terminal 外壳：cmd / ps / bash')
    p.add_argument('--entry', action='append', default=[], help='terminal 条目 cwd|||cmd|||output|||exit，可重复')
    p.add_argument('--entries-file', dest='entries_file', help='terminal 条目 JSON 数组文件')
    p.add_argument('--ai-action', dest='ai_action'); p.add_argument('--ai-note', dest='ai_note'); p.add_argument('--ai-success', dest='ai_success')
    p.add_argument('--size', default=None); p.add_argument('--budget', type=int, default=8000); p.add_argument('--zoom', default='1.6')
    p.set_defaults(f=cmd_capture)
    a = ap.parse_args()
    try: return a.f(a)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr); return 1


if __name__ == '__main__':
    if os.environ.get("ARTEX_WEBURP_RENDERER") == "1":
        from artex_renderer import configure
        configure(sys.modules[__name__])
    sys.exit(main())
