//! Agent Markdown to Telegram's HTML: bold, italics, strikethrough, inline
//! code, code blocks with their language, links, lists, quotes, headings and
//! tables. Telegram renders only a few tags, so everything else becomes text
//! that reads well: headings bold, tables monospace, images as links.

use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

/// Telegram's limit for one message, after entities are parsed.
pub const TELEGRAM_MAX_CHARS: usize = 4096;

/// Converts one message's Markdown to Telegram HTML.
pub fn to_html(markdown: &str) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut out = Renderer::default();
    for event in Parser::new_ext(markdown, options) {
        out.event(event);
    }
    out.finish()
}

#[derive(Default)]
struct Renderer {
    html: String,
    /// One entry per open list: the next number, or None for bullets.
    lists: Vec<Option<u64>>,
    /// Inside a code block: no tags, just escaped text.
    in_code: bool,
    /// Table being collected: rows of cells, then rendered as monospace.
    table: Option<Table>,
    /// Open link targets (an image inside a link keeps the outer link).
    links: Vec<String>,
}

#[derive(Default)]
struct Table {
    rows: Vec<Vec<String>>,
    cell: String,
}

impl Renderer {
    fn event(&mut self, event: Event) {
        if let Some(table) = &mut self.table {
            match event {
                Event::End(TagEnd::Table) => {
                    let table = self.table.take().expect("in a table");
                    self.block_break();
                    self.html.push_str("<pre>");
                    self.html.push_str(&escape(&render_table(&table.rows)));
                    self.html.push_str("</pre>");
                    self.block_end();
                }
                Event::Start(Tag::TableHead | Tag::TableRow) => table.rows.push(Vec::new()),
                Event::End(TagEnd::TableCell) => {
                    let cell = std::mem::take(&mut table.cell);
                    if let Some(row) = table.rows.last_mut() {
                        row.push(cell.trim().to_string());
                    }
                }
                Event::Text(t) | Event::Code(t) => table.cell.push_str(&t),
                Event::SoftBreak | Event::HardBreak => table.cell.push(' '),
                _ => {}
            }
            return;
        }

        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(text) => self.html.push_str(&escape(&text)),
            Event::Code(code) => {
                self.html.push_str("<code>");
                self.html.push_str(&escape(&code));
                self.html.push_str("</code>");
            }
            Event::InlineMath(m) | Event::DisplayMath(m) => {
                self.html.push_str("<code>");
                self.html.push_str(&escape(&m));
                self.html.push_str("</code>");
            }
            Event::Html(raw) | Event::InlineHtml(raw) => self.html.push_str(&escape(&raw)),
            Event::SoftBreak | Event::HardBreak => self.html.push('\n'),
            Event::Rule => {
                self.block_break();
                self.html.push_str("———");
                self.block_end();
            }
            Event::TaskListMarker(done) => self.html.push_str(if done { "☑ " } else { "☐ " }),
            Event::FootnoteReference(name) => {
                self.html.push_str(&format!("[{}]", escape(&name)));
            }
        }
    }

    fn start(&mut self, tag: Tag) {
        match tag {
            Tag::Paragraph => self.block_break(),
            Tag::Heading { level, .. } => {
                self.block_break();
                self.html.push_str(if level == HeadingLevel::H1 {
                    "<b><u>"
                } else {
                    "<b>"
                });
            }
            Tag::BlockQuote(_) => {
                self.block_break();
                self.html.push_str("<blockquote>");
            }
            Tag::CodeBlock(kind) => {
                self.block_break();
                self.in_code = true;
                match kind {
                    CodeBlockKind::Fenced(lang) if !lang.trim().is_empty() => {
                        let lang: String = lang
                            .split_whitespace()
                            .next()
                            .unwrap_or("")
                            .chars()
                            .filter(|c| {
                                c.is_ascii_alphanumeric() || matches!(c, '-' | '+' | '#' | '_')
                            })
                            .collect();
                        self.html
                            .push_str(&format!("<pre><code class=\"language-{lang}\">"));
                    }
                    _ => self.html.push_str("<pre><code>"),
                }
            }
            Tag::List(first) => {
                if self.lists.is_empty() {
                    self.block_break();
                }
                self.lists.push(first);
            }
            Tag::Item => {
                if !self.html.ends_with('\n') && !self.html.is_empty() {
                    self.html.push('\n');
                }
                let depth = self.lists.len().saturating_sub(1);
                self.html.push_str(&"   ".repeat(depth));
                match self.lists.last_mut() {
                    Some(Some(n)) => {
                        self.html.push_str(&format!("{n}. "));
                        *n += 1;
                    }
                    _ => self.html.push_str(if depth == 0 { "• " } else { "◦ " }),
                }
            }
            Tag::Emphasis => self.html.push_str("<i>"),
            Tag::Strong => self.html.push_str("<b>"),
            Tag::Strikethrough => self.html.push_str("<s>"),
            Tag::Link { dest_url, .. } => {
                let href = safe_href(&dest_url);
                if let Some(h) = &href {
                    self.html
                        .push_str(&format!("<a href=\"{}\">", escape_attr(h)));
                }
                self.links
                    .push(href.map(|_| "a".to_string()).unwrap_or_default());
            }
            Tag::Image { dest_url, .. } => {
                // Telegram can't show images inside text; link to it instead.
                let href = safe_href(&dest_url);
                self.html.push_str("🖼 ");
                match &href {
                    Some(h) if self.links.iter().all(|l| l.is_empty()) => {
                        self.html
                            .push_str(&format!("<a href=\"{}\">", escape_attr(h)));
                        self.links.push("a".into());
                    }
                    _ => self.links.push(String::new()),
                }
            }
            Tag::Table(_) => self.table = Some(Table::default()),
            Tag::FootnoteDefinition(name) => {
                self.block_break();
                self.html.push_str(&format!("[{}] ", escape(&name)));
            }
            _ => {}
        }
    }

    fn end(&mut self, tag: TagEnd) {
        match tag {
            TagEnd::Paragraph => self.block_end(),
            TagEnd::Heading(level) => {
                self.html.push_str(if level == HeadingLevel::H1 {
                    "</u></b>"
                } else {
                    "</b>"
                });
                self.block_end();
            }
            TagEnd::BlockQuote(_) => {
                trim_end_in_place(&mut self.html);
                self.html.push_str("</blockquote>");
                self.block_end();
            }
            TagEnd::CodeBlock => {
                trim_trailing_newlines(&mut self.html);
                self.html.push_str("</code></pre>");
                self.in_code = false;
                self.block_end();
            }
            TagEnd::List(_) => {
                self.lists.pop();
                if self.lists.is_empty() {
                    self.block_end();
                }
            }
            TagEnd::Emphasis => self.html.push_str("</i>"),
            TagEnd::Strong => self.html.push_str("</b>"),
            TagEnd::Strikethrough => self.html.push_str("</s>"),
            TagEnd::Link | TagEnd::Image if self.links.pop().is_some_and(|l| !l.is_empty()) => {
                self.html.push_str("</a>");
            }
            _ => {}
        }
    }

    /// Starts a block on a fresh line (one blank line after the last block).
    fn block_break(&mut self) {
        if self.in_code || self.html.is_empty() || self.html.ends_with("<blockquote>") {
            return;
        }
        if !self.lists.is_empty() {
            // Paragraphs inside list items stay on the item's line.
            return;
        }
        trim_end_in_place(&mut self.html);
        self.html.push_str("\n\n");
    }

    fn block_end(&mut self) {
        if self.lists.is_empty() {
            self.html.push_str("\n\n");
        }
    }

    fn finish(mut self) -> String {
        trim_end_in_place(&mut self.html);
        // Collapse runs of blank lines left by nested blocks.
        let mut out = String::with_capacity(self.html.len());
        let mut newlines = 0;
        for c in self.html.trim_start().chars() {
            if c == '\n' {
                newlines += 1;
                if newlines > 2 {
                    continue;
                }
            } else {
                newlines = 0;
            }
            out.push(c);
        }
        out
    }
}

/// Columns padded to their widest cell, with a rule under the header.
fn render_table(rows: &[Vec<String>]) -> String {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut widths = vec![0; columns];
    for row in rows {
        for (i, cell) in row.iter().enumerate() {
            widths[i] = widths[i].max(cell.chars().count());
        }
    }
    let mut out = String::new();
    for (r, row) in rows.iter().enumerate() {
        let line: Vec<String> = (0..columns)
            .map(|i| {
                let cell = row.get(i).map(String::as_str).unwrap_or("");
                let pad = widths[i] - cell.chars().count();
                format!("{cell}{}", " ".repeat(pad))
            })
            .collect();
        out.push_str(line.join(" │ ").trim_end());
        out.push('\n');
        if r == 0 && rows.len() > 1 {
            let rule: Vec<String> = widths.iter().map(|w| "─".repeat(*w)).collect();
            out.push_str(&rule.join("─┼─"));
            out.push('\n');
        }
    }
    out.trim_end().to_string()
}

/// Links Telegram can open; anything else (javascript:, relative paths) is
/// shown as plain text.
fn safe_href(url: &str) -> Option<String> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    ["https://", "http://", "tg://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
        .then(|| url.to_string())
}

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            c => out.push(c),
        }
    }
    out
}

fn escape_attr(text: &str) -> String {
    escape(text).replace('"', "&quot;")
}

fn trim_end_in_place(s: &mut String) {
    let len = s.trim_end().len();
    s.truncate(len);
}

fn trim_trailing_newlines(s: &mut String) {
    while s.ends_with('\n') {
        s.pop();
    }
}

/// Characters Telegram counts once entities are parsed: the text without
/// tags, with `&amp;`-style escapes counted as one.
pub fn visible_len(html: &str) -> usize {
    let mut count = 0;
    let mut in_tag = false;
    let mut in_entity = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            '&' if !in_tag => {
                in_entity = true;
                count += 1;
            }
            ';' if in_entity => in_entity = false,
            _ if in_tag || in_entity => {}
            _ => count += 1,
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_markdown_becomes_telegram_html() {
        let html = to_html(
            "# Title\n\nSome **bold**, *italic*, `code` and [a link](https://x.ai).\n\n\
             - one\n- two\n\n```rust\nfn main() {}\n```\n\n> quoted <tag> & more",
        );
        assert_eq!(
            html,
            "<b><u>Title</u></b>\n\nSome <b>bold</b>, <i>italic</i>, <code>code</code> and \
             <a href=\"https://x.ai\">a link</a>.\n\n• one\n• two\n\n\
             <pre><code class=\"language-rust\">fn main() {}</code></pre>\n\n\
             <blockquote>quoted &lt;tag&gt; &amp; more</blockquote>"
        );
    }

    #[test]
    fn tables_are_monospace_and_unsafe_links_are_text() {
        let html = to_html("| a | bb |\n|---|---|\n| 1 | 2 |\n\n[x](javascript:alert(1))");
        assert!(
            html.starts_with("<pre>a │ bb\n──┼───\n1 │ 2</pre>"),
            "{html}"
        );
        assert!(html.ends_with("x"), "{html}");
        assert_eq!(visible_len("<b>a&amp;b</b>"), 3);
    }
}
