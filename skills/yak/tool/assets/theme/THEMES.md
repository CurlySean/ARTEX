# Theme File Format

Theme files are JSON documents that define color schemes for the application. This document describes the theme file syntax and structure.

## File Structure

A theme file has the following top-level structure:

```json
{
  "name": "Theme Name",
  "dark": false,
  "colors": {
    "swatches": { ... },
    "palette": { ... },
    "ui": { ... }
  }
}
```

### Required Fields

- `name` (string): The display name of the theme
- `dark` (boolean): Whether this theme extends DarkTheme (`true`) or LightTheme (`false`)
- `colors` (object): Container for all color definitions

### Example: Minimal Custom Theme

Here's a complete working example that changes only the primary accent color:

```json
{
  "name": "My Custom Theme",
  "dark": false,
  "colors": {
    "swatches": {
      "myRed": "#FF0000"
    },
    "palette": {
      "primary": "@myRed"
    }
  }
}
```

This theme extends LightTheme and overrides only the `primary` palette by pointing it to a custom swatch. All other colors fall back to LightTheme's defaults.

### The `dark` Property and Fallback Behavior

When `dark` is `false`, the theme extends LightTheme. When `dark` is `true`, it extends DarkTheme.

Any palette or UI color keys omitted from your theme file will fall back to the values defined in the base theme (LightTheme or DarkTheme). You only need to define values you want to override.

## Colors Section

The `colors` object contains three optional subsections: `swatches`, `palette`, and `ui`.

### Understanding Swatches vs. Palettes

**Swatches** are color variables that can be referenced throughout your theme:
- The base themes define 10 swatches: `orange`, `blue`, `red`, `purple`, `teal`, `magenta`, `green`, `yellow`, `black`, `white`
- You can reference these base swatches without defining them (e.g., `@blue[3]`)
- You can override base swatches by redefining them in your theme file
- You can create your own custom swatches with any name containing only letters (e.g., `myBlue`, `brandOrange`)
- Must be referenced with `@` prefix

**Palettes** are predefined color schemes the theming engine uses:
- Fixed names: `mono`, `primary`, `secondary`, `tertiary`, `error`, `warning`, `info`, `success`, `hint`
- These directly control UI element colors
- Can be referenced with `$` prefix in UI section

**Example workflow:**
1. Define reusable colors as swatches: `"brandBlue": "#1E90FF"`
2. Reference swatches in palettes: `"primary": "@brandBlue"`
3. The UI automatically uses the `primary` palette for buttons, links, etc.

### Swatches

Swatches are reusable color definitions. The base themes (Light and Dark) define 10 swatches that you can reference directly:

- `orange`, `blue`, `red`, `purple`, `teal`, `magenta`, `green`, `yellow`, `black`, `white`

You can also define your own swatches, or override base swatches by redefining them. Swatches are not applied directly to any UI elements - they're referenced by palettes and UI colors.

#### Color Literal

The simplest swatch is a hex color:

```json
"swatches": {
  "red": "#FF0000"
}
```

Supports 6-digit (`#RRGGBB`) or 8-digit (`#RRGGBBAA`) hex colors.

#### Swatch with Shades

Swatches can define a core color and up to 8 shades:

```json
"swatches": {
  "blue": {
    "core": "#26649D",
    "shades": [
      "#323945",
      "#2C5175",
      "#5384B2",
      "#79A0C3",
      "#9FBBD4",
      "#CADAF0",
      "#EBF1F6"
    ]
  }
}
```

**Shade Filling:** You can provide fewer than 8 shades. The parser will fill remaining shades with the last provided shade value. If you provide no shades array, all 8 shades will use the core value.

```json
"swatches": {
  "gray": {
    "core": "#808080",
    "shades": ["#404040", "#606060"]
  }
}
```
This creates:
- Shade 1: `#404040`
- Shade 2: `#606060`
- Shades 3-8: `#606060` (filled with last provided shade)

**Shade Ordering:** Shades typically follow a dark-to-light progression (shades 1-2 darker than core, shades 3-8 progressively lighter), but this is not enforced. You can arrange shades in any order that suits your design needs.

### Palette

Palettes are the named color schemes used directly by the theming engine. Unlike swatches (which are custom definitions), palettes have predefined names that map to specific UI purposes.

The 9 available palettes are:

- `mono` - Monochrome colors
- `primary` - Primary accent color
- `secondary` - Secondary accent color
- `tertiary` - Tertiary accent color
- `error` - Error state color
- `warning` - Warning state color
- `info` - Information color
- `success` - Success state color
- `hint` - Hint/tooltip color

**Important:** You can only override these 9 palettes. You cannot create custom palette names - if you need custom colors, define them as swatches instead.

#### Palette Syntax

Palettes must reference a swatch using the `@swatchName` syntax. This copies the core and all 8 shades from the swatch to the palette:

```json
"palette": {
  "primary": "@orange",
  "error": "@red"
}
```

This copies the core and all 8 shades from each swatch to the corresponding palette.

You can reference:
- Base theme swatches: `@orange`, `@blue`, `@red`, `@purple`, `@teal`, `@magenta`, `@green`, `@yellow`, `@black`, `@white`
- Custom swatches defined in your theme file

### UI Colors

The `ui` section defines colors for specific UI elements used throughout the application.

#### Available UI Color Keys

| Key | Description |
|-----|-------------|
| `background.1` | Lightest background, used for panels and containers |
| `background.2` | Default background for most UI elements |
| `background.3` | Slightly darker background for contrast |
| `background.4` | Medium background for borders and separators |
| `background.5` | Inactive/disabled background elements |
| `background.6` | Selected/highlighted background |
| `background.7` | Error background tint |
| `background.8` | Tertiary/alternate background tint |
| `background.9` | Error highlight background |
| `background.10` | Hint/tooltip background |
| `text.header` | Header and title text |
| `text.body` | Primary body text |
| `text.hover` | Text color on hover |
| `text.disabled` | Disabled/inactive text |
| `text.link` | Hyperlink text |
| `text.linkHover` | Hyperlink text on hover |
| `text.ai` | AI-related text |
| `text.aiHover` | AI-related text on hover |
| `text.error` | Error message text |
| `text.information` | Informational text |
| `text.white` | Text for non-mono backgrounds (e.g., primary colored buttons) |
| `icon.default` | Default icon color |
| `icon.hover` | Icon color on hover |
| `icon.disabled` | Disabled icon color |
| `icon.link` | Hyperlink icon color |
| `icon.linkHover` | Hyperlink icon color on hover |
| `icon.ai` | AI-related icon color |
| `icon.error` | Error icon color |
| `icon.information` | Information icon color |
| `icon.warning` | Warning icon color |
| `icon.success` | Success icon color |
| `icon.white` | Icon for non-mono backgrounds (e.g., primary colored buttons) |
| `groups.0.accent` | Tab group 0 accent color |
| `groups.0.background` | Tab group 0 background color |
| `groups.1.accent` | Tab group 1 accent color |
| `groups.1.background` | Tab group 1 background color |
| `groups.2.accent` | Tab group 2 accent color |
| `groups.2.background` | Tab group 2 background color |
| `groups.3.accent` | Tab group 3 accent color |
| `groups.3.background` | Tab group 3 background color |
| `groups.4.accent` | Tab group 4 accent color |
| `groups.4.background` | Tab group 4 background color |
| `groups.5.accent` | Tab group 5 accent color |
| `groups.5.background` | Tab group 5 background color |
| `groups.6.accent` | Tab group 6 accent color |
| `groups.6.background` | Tab group 6 background color |
| `groups.7.accent` | Tab group 7 accent color |
| `groups.7.background` | Tab group 7 background color |
| `groups.8.accent` | Tab group 8 accent color |
| `groups.8.background` | Tab group 8 background color |
| `groups.9.accent` | Tab group 9 accent color |
| `groups.9.background` | Tab group 9 background color |
| `groups.10.accent` | Tab group 10 accent color |
| `groups.10.background` | Tab group 10 background color |
| `groups.11.accent` | Tab group 11 accent color |
| `groups.11.background` | Tab group 11 background color |
| `groups.12.accent` | Tab group 12 accent color |
| `groups.12.background` | Tab group 12 background color |
| `groups.13.accent` | Tab group 13 accent color |
| `groups.13.background` | Tab group 13 background color |
| `groups.14.accent` | Tab group 14 accent color |
| `groups.14.background` | Tab group 14 background color |
| `highlight.0.background` | Highlight color 0 background |
| `highlight.0.text` | Highlight color 0 text |
| `highlight.1.background` | Highlight color 1 background |
| `highlight.1.text` | Highlight color 1 text |
| `highlight.2.background` | Highlight color 2 background |
| `highlight.2.text` | Highlight color 2 text |
| `highlight.3.background` | Highlight color 3 background |
| `highlight.3.text` | Highlight color 3 text |
| `highlight.4.background` | Highlight color 4 background |
| `highlight.4.text` | Highlight color 4 text |
| `highlight.5.background` | Highlight color 5 background |
| `highlight.5.text` | Highlight color 5 text |
| `highlight.6.background` | Highlight color 6 background |
| `highlight.6.text` | Highlight color 6 text |
| `highlight.7.background` | Highlight color 7 background |
| `highlight.7.text` | Highlight color 7 text |
| `highlight.8.background` | Highlight color 8 background |
| `highlight.8.text` | Highlight color 8 text |
| `target.method.connect` | HTTP CONNECT method color |
| `target.method.delete` | HTTP DELETE method color |
| `target.method.get` | HTTP GET method color |
| `target.method.head` | HTTP HEAD method color |
| `target.method.options` | HTTP OPTIONS method color |
| `target.method.patch` | HTTP PATCH method color |
| `target.method.post` | HTTP POST method color |
| `target.method.put` | HTTP PUT method color |
| `target.method.trace` | HTTP TRACE method color |
| `target.method.unknown` | Unknown HTTP method color |
| `editor.java.class` | Java class name color |
| `editor.java.error` | Java error color |
| `editor.java.interface` | Java interface name color |
| `editor.java.method` | Java method name color |
| `editor.java.package` | Java package name color |
| `editor.java.variable` | Java variable name color |
| `editor.message.highlight.alert` | Message editor alert highlight |
| `editor.message.highlight.defaultFixed` | Message editor default fixed highlight |
| `editor.message.highlight.search` | Message editor search highlight |
| `editor.message.compare.added` | Message comparison added lines |
| `editor.message.compare.deleted` | Message comparison deleted lines |
| `editor.message.compare.modified` | Message comparison modified lines |
| `editor.message.annotation` | XML/HTML annotation color |
| `editor.message.background` | Message editor background |
| `editor.message.cdata` | XML CDATA section color |
| `editor.message.cdataDelimiter` | XML CDATA delimiter color |
| `editor.message.comment` | Comment color |
| `editor.message.cookieName` | HTTP cookie name color |
| `editor.message.cookieValue` | HTTP cookie value color |
| `editor.message.currentLineBackground` | Current line highlight background |
| `editor.message.datatype` | Data type color |
| `editor.message.entityReference` | XML entity reference color |
| `editor.message.function` | Function name color |
| `editor.message.gutterBorder` | Line number gutter border |
| `editor.message.headerName` | HTTP header name color |
| `editor.message.headerValue` | HTTP header value color |
| `editor.message.httpFirstLine` | HTTP first line color (request/response line) |
| `editor.message.lineNumbers` | Line number color |
| `editor.message.literalBoolean` | Boolean literal color |
| `editor.message.literalNumber` | Number literal color |
| `editor.message.literalQuote` | String quote color |
| `editor.message.literalString` | String literal color |
| `editor.message.lozengeBackground` | Lozenge badge background |
| `editor.message.lozengeText` | Lozenge badge text |
| `editor.message.nestedLanguageBackground` | Nested language block background |
| `editor.message.operator` | Operator color |
| `editor.message.paramName` | URL parameter name color |
| `editor.message.paramValue` | URL parameter value color |
| `editor.message.preprocessor` | Preprocessor directive color |
| `editor.message.processingInstruction` | XML processing instruction color |
| `editor.message.regex` | Regular expression color |
| `editor.message.reservedWord` | Reserved keyword color |
| `editor.message.reservedWord2` | Secondary reserved keyword color |
| `editor.message.selectionBackground` | Text selection background |
| `editor.message.selectionForeground` | Text selection foreground |
| `editor.message.separator` | Separator color |
| `editor.message.tagDelimiter` | XML/HTML tag delimiter color |
| `editor.message.tagName` | XML/HTML tag name color |
| `editor.message.text` | Default text color |
| `editor.message.variable` | Variable name color |
| `status.new` | New status indicator |
| `status.inProgress` | In progress status indicator |
| `status.postponed` | Postponed status indicator |
| `status.ignored` | Ignored status indicator |
| `status.done` | Done/completed status indicator |
| `issue.high` | High severity issue color |
| `issue.medium` | Medium severity issue color |
| `issue.low` | Low severity issue color |
| `issue.info` | Informational issue color |

#### UI Color Syntax

UI colors support the same reference syntax as swatches and palettes:

**Color literal:**
```json
"ui": {
  "editor": {
    "message": {
      "annotation": "#005A00"
    }
  }
}
```

**Swatch reference:**
```json
"ui": {
  "text": {
    "white": "@white"
  }
}
```

**Swatch shade reference:**
```json
"ui": {
  "groups": {
    "0": {
      "accent": "@purple[5]"
    }
  }
}
```

**Palette reference:**
```json
"ui": {
  "text": {
    "body": "$mono[8]"
  }
}
```

## Reference Syntax Summary

### Swatch References (use `@` prefix)

| Syntax | In Palette Section | In UI Section |
|--------|-------------------|---------------|
| `@red` | Copies all shades individually | References core value (shorthand for `@red.core`) |
| `@red.core` or `@red[0]` | Not allowed | References core value (explicit notation) |
| `@red[3]` | Not allowed | References shade 3 |

**Note:** In the palette section, only full swatch references (`@swatchName`) are allowed. In the UI section, `@red`, `@red.core`, and `@red[0]` are all equivalent - they all reference the swatch's core value.

### Palette References (use `$` prefix)

| Syntax | Meaning | Usage Context |
|--------|---------|---------------|
| `$primary` or `$primary.core` or `$primary[0]` | References core value | ui only |
| `$primary[3]` | References shade 3 | ui only |

## Validation Rules

- Swatch names must contain only letters (A-Z, a-z)
- Palette names must be one of the 9 predefined names: `mono`, `primary`, `secondary`, `tertiary`, `error`, `warning`, `info`, `success`, `hint`
- Palette values must be full swatch references (`@swatchName`) - hex literals, swatch core/shade references, and objects are not allowed
- Color values must be valid hex colors: `#RRGGBB` or `#RRGGBBAA`
- Swatch references (`@name`) can reference any of the 10 base theme swatches (`orange`, `blue`, `red`, `purple`, `teal`, `magenta`, `green`, `yellow`, `black`, `white`) or swatches defined in your theme file
- Palette references (`$name`) can reference any of the 9 base theme palettes, whether or not you override them in your theme file
- Shade indices must be 0-8 (0 is core, 1-8 are shades)
- You cannot reference UI color keys within the theme file

## Notes

- The `swatches`, `palette`, and `ui` sections are all optional
- If a section is empty, you can omit it entirely or include it as an empty object `{}`
- Shades are indexed 1-8, while bracket notation `[0]` refers to the core value
- The `.core` notation and `[0]` bracket notation are equivalent
