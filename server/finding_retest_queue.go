package server

import (
	"context"
	"log"
	"time"

	"github.com/Autumn-27/artex/agent"
)

type retestQueuedRunKey struct{}

// One queue for both individual and batch retests. The database owns pending
// jobs; the in-process map also counts cancelled runs until they actually exit.
func (s *Server) wakeFindingRetests() {
	if s.m.pg == nil || s.ctx.Err() != nil {
		return
	}
	s.retestOnce.Do(func() {
		s.retestWake = make(chan struct{}, 1)
		s.retestMu.Lock()
		s.retestActive = make(map[int64]context.CancelCauseFunc)
		s.retestMu.Unlock()
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-s.ctx.Done():
					return
				case <-s.retestWake:
				case <-ticker.C:
				}
				s.dispatchFindingRetests()
			}
		}()
	})
	select {
	case s.retestWake <- struct{}{}:
	default:
	}
}
func (s *Server) dispatchFindingRetests() {
	s.retestMu.Lock()
	defer s.retestMu.Unlock()
	limit := s.m.pg.RetestConcurrency()
	for len(s.retestActive) < limit && s.ctx.Err() == nil {
		r, err := s.m.pg.ClaimFindingRetest(s.ctx, limit)
		if err != nil {
			if s.ctx.Err() == nil {
				log.Printf("[retest queue] claim: %v", err)
			}
			return
		}
		if r == nil {
			return
		}
		c, err := s.m.pg.GetConversation(*r.ConversationID)
		if err != nil || c == nil {
			s.finishRetest(r.ID, "failed", "复测会话读取失败或已删除")
			continue
		}
		busy := s.convBusyKey(c.ID)
		s.chatMu.Lock()
		s.chatBusy[busy] = true
		s.chatMu.Unlock()
		// Register cancellation under the same lock as batch stop, before starting.
		ctx, cancel := s.conversationRunContext(c.ID, busy)
		s.retestActive[c.ID] = cancel
		s.retestWG.Add(1)
		go func() {
			defer s.retestWG.Done()
			defer func() { s.retestMu.Lock(); delete(s.retestActive, c.ID); s.retestMu.Unlock(); s.wakeFindingRetests() }()
			s.runConversationTurn(context.WithValue(ctx, retestQueuedRunKey{}, true), cancel, c, r.InitialMessage(), busy)
		}()
	}
}

func (s *Server) stopRetestConversation(id int64) error {
	s.retestMu.Lock()
	defer s.retestMu.Unlock()
	r, err := s.m.pg.FindingRetestForConversation(context.Background(), id)
	if err != nil {
		return err
	}
	if r != nil && (r.Status == "pending" || r.Status == "running") {
		if err = s.m.pg.FinishFindingRetest(r.ID, "stopped", "复测已手动停止"); err != nil {
			return err
		}
		if cancel := s.retestActive[id]; cancel != nil {
			cancel(agent.AbortChatStoppedByUser)
		}
	}
	return nil
}
