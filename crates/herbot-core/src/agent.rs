//! Conversation agents run as T3 Code threads, driven through T3's host CLI
//! (`t3 thread start|send|list`). Each conversation folder is a T3 project, so
//! Codex reads that folder's AGENTS.md.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// How a turn ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnOutcome {
    /// The agent answered.
    Replied(String),
    /// The run failed inside T3/Codex.
    Failed(String),
    /// The agent is waiting for an answer in the T3 app (Step 6 brings these to Telegram).
    NeedsAnswer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnResult {
    pub thread_id: String,
    pub outcome: TurnOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadInfo {
    pub thread_id: String,
    pub title: String,
    pub link: Option<String>,
}

#[derive(Debug, Clone, thiserror::Error, PartialEq, Eq)]
pub enum AgentError {
    #[error("could not run the T3 CLI: {0}")]
    Spawn(String),
    #[error("the agent did not finish within {0} seconds")]
    Timeout(u64),
    #[error("unexpected T3 CLI output (exit {exit:?}): {detail}")]
    BadOutput { exit: Option<i32>, detail: String },
    #[error("could not add the conversation folder to T3: {0}")]
    Project(String),
}

/// What Herbot needs from an agent backend. Implemented by [`T3Cli`] and by a
/// fake in tests.
pub trait AgentRunner: Send + Sync + 'static {
    /// Makes sure `folder` is a T3 project (safe to call repeatedly).
    fn ensure_project(
        &self,
        folder: &Path,
        title: &str,
    ) -> impl Future<Output = Result<(), AgentError>> + Send;

    /// Starts a thread in `folder` with a first message and waits for the reply.
    fn start(
        &self,
        folder: &Path,
        title: &str,
        message: &str,
    ) -> impl Future<Output = Result<TurnResult, AgentError>> + Send;

    /// Sends a message to an existing thread and waits for the reply.
    fn send(
        &self,
        thread_id: &str,
        message: &str,
    ) -> impl Future<Output = Result<TurnResult, AgentError>> + Send;

    /// Threads in a project folder, newest first.
    fn list(
        &self,
        folder: &Path,
    ) -> impl Future<Output = Result<Vec<ThreadInfo>, AgentError>> + Send;
}

/// Reads `model_reasoning_effort` from a Codex `config.toml` (top-level keys
/// only). T3 doesn't pass an effort, so Codex uses this one.
pub fn codex_config_effort(config_toml: &str) -> Option<String> {
    for line in config_toml.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            break; // past the top-level table
        }
        if let Some(value) = line.strip_prefix("model_reasoning_effort") {
            let value = value.trim_start().strip_prefix('=')?.trim();
            return Some(value.trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

/// Boxed future, so [`ProjectCleaner`] stays object-safe.
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What `/new` and `/forget` need from T3 to delete a conversation's threads.
/// Deletion is only ever by exact project id, never by path: the agents
/// folder sits inside other T3 projects (like the herbot repo), and T3
/// resolves a path to the nearest enclosing project.
pub trait ProjectCleaner: Send + Sync {
    /// The project a thread belongs to; `None` if T3 no longer has the thread.
    fn project_of_thread<'a>(
        &'a self,
        thread_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, AgentError>>;
    /// Every thread id in a project.
    fn threads_in_project<'a>(
        &'a self,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, AgentError>>;
    /// Deletes a project and all its threads.
    fn remove_project<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, Result<(), AgentError>>;
}

/// T3 project ids are UUIDs. Anything else (a path!) is refused.
pub fn is_project_id(id: &str) -> bool {
    id.len() == 36
        && id.chars().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// T3 Code's host CLI.
#[derive(Debug, Clone)]
pub struct T3Cli {
    pub bin: PathBuf,
    pub provider: String,
    pub model: String,
    pub timeout: Duration,
}

#[derive(Debug, Deserialize)]
struct CliTurn {
    #[serde(rename = "threadId")]
    thread_id: String,
    status: Option<String>,
    reply: Option<String>,
    error: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct CliThread {
    #[serde(rename = "threadId")]
    thread_id: String,
    title: Option<String>,
    link: Option<String>,
}

/// Interprets `t3 thread start|send --wait --json`. Exit 0 = finished,
/// 1 = the run failed, 2 = waiting for an answer in the app.
pub fn parse_turn(exit: Option<i32>, stdout: &str, stderr: &str) -> Result<TurnResult, AgentError> {
    let bad = |detail: String| AgentError::BadOutput { exit, detail };
    let turn: Option<CliTurn> = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .and_then(|l| serde_json::from_str(l.trim()).ok());

    match (exit, turn) {
        (Some(0), Some(t)) => match t.reply {
            Some(reply) if !reply.trim().is_empty() => Ok(TurnResult {
                thread_id: t.thread_id,
                outcome: TurnOutcome::Replied(reply),
            }),
            _ => Ok(TurnResult {
                thread_id: t.thread_id,
                outcome: TurnOutcome::Failed(format!(
                    "finished with status {:?} but no reply",
                    t.status.unwrap_or_default()
                )),
            }),
        },
        (Some(1), Some(t)) => Ok(TurnResult {
            thread_id: t.thread_id,
            outcome: TurnOutcome::Failed(match t.error {
                Some(serde_json::Value::String(s)) => s,
                Some(other) if !other.is_null() => other.to_string(),
                _ => format!("run ended with status {:?}", t.status.unwrap_or_default()),
            }),
        }),
        (Some(2), Some(t)) => Ok(TurnResult {
            thread_id: t.thread_id,
            outcome: TurnOutcome::NeedsAnswer,
        }),
        (_, _) => Err(bad(first_line(stderr, stdout))),
    }
}

fn first_line(stderr: &str, stdout: &str) -> String {
    let text = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    text.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("no output")
        .chars()
        .take(300)
        .collect()
}

pub fn parse_list(stdout: &str) -> Result<Vec<ThreadInfo>, AgentError> {
    let threads: Vec<CliThread> =
        serde_json::from_str(stdout.trim()).map_err(|e| AgentError::BadOutput {
            exit: Some(0),
            detail: format!("thread list: {e}"),
        })?;
    Ok(threads
        .into_iter()
        .map(|t| ThreadInfo {
            thread_id: t.thread_id,
            title: t.title.unwrap_or_default(),
            link: t.link,
        })
        .collect())
}

struct Output {
    exit: Option<i32>,
    stdout: String,
    stderr: String,
}

impl T3Cli {
    async fn run(
        &self,
        args: &[&str],
        stdin: Option<&str>,
        timeout: Duration,
    ) -> Result<Output, AgentError> {
        let mut cmd = Command::new(&self.bin);
        cmd.args(args)
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd
            .spawn()
            .map_err(|e| AgentError::Spawn(format!("{}: {e}", self.bin.display())))?;
        // Include stdin in the deadline: a CLI that stops reading must not
        // hold a conversation lane forever on a large message.
        let output = tokio::time::timeout(timeout, async {
            if let Some(input) = stdin {
                let mut pipe = child.stdin.take().expect("stdin was piped");
                pipe.write_all(input.as_bytes())
                    .await
                    .map_err(|e| AgentError::Spawn(e.to_string()))?;
            }
            child
                .wait_with_output()
                .await
                .map_err(|e| AgentError::Spawn(e.to_string()))
        })
        .await
        .map_err(|_| AgentError::Timeout(timeout.as_secs()))??;
        Ok(Output {
            exit: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }
}

const QUICK: Duration = Duration::from_secs(60);

impl ProjectCleaner for T3Cli {
    fn project_of_thread<'a>(
        &'a self,
        thread_id: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, AgentError>> {
        Box::pin(async move {
            let out = self
                .run(&["thread", "show", thread_id, "--json"], None, QUICK)
                .await?;
            let all = format!("{}\n{}", out.stdout, out.stderr).to_lowercase();
            if out.exit != Some(0) {
                return if all.contains("no longer available") || all.contains("not found") {
                    Ok(None)
                } else {
                    Err(AgentError::BadOutput {
                        exit: out.exit,
                        detail: first_line(&out.stderr, &out.stdout),
                    })
                };
            }
            let value: serde_json::Value =
                serde_json::from_str(out.stdout.trim()).map_err(|e| AgentError::BadOutput {
                    exit: out.exit,
                    detail: format!("thread show: {e}"),
                })?;
            Ok(value["thread"]["projectId"].as_str().map(str::to_string))
        })
    }

    fn threads_in_project<'a>(
        &'a self,
        project_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<String>, AgentError>> {
        Box::pin(async move {
            if !is_project_id(project_id) {
                return Err(AgentError::Project(format!(
                    "{project_id:?} is not a T3 project id"
                )));
            }
            let out = self
                .run(
                    &["thread", "list", "--project", project_id, "--json"],
                    None,
                    QUICK,
                )
                .await?;
            if out.exit != Some(0) {
                return Err(AgentError::BadOutput {
                    exit: out.exit,
                    detail: first_line(&out.stderr, &out.stdout),
                });
            }
            Ok(parse_list(&out.stdout)?
                .into_iter()
                .map(|t| t.thread_id)
                .collect())
        })
    }

    fn remove_project<'a>(&'a self, project_id: &'a str) -> BoxFuture<'a, Result<(), AgentError>> {
        Box::pin(async move {
            if !is_project_id(project_id) {
                return Err(AgentError::Project(format!(
                    "refusing to remove {project_id:?}: not a T3 project id"
                )));
            }
            let out = self
                .run(&["project", "remove", "--force", project_id], None, QUICK)
                .await?;
            if out.exit == Some(0) {
                Ok(())
            } else {
                Err(AgentError::Project(first_line(&out.stderr, &out.stdout)))
            }
        })
    }
}

impl AgentRunner for T3Cli {
    async fn ensure_project(&self, folder: &Path, title: &str) -> Result<(), AgentError> {
        let folder = folder.to_string_lossy();
        let out = self
            .run(
                &["project", "add", folder.as_ref(), "--title", title],
                None,
                QUICK,
            )
            .await?;
        let all = format!("{}\n{}", out.stdout, out.stderr).to_lowercase();
        if out.exit == Some(0) || all.contains("already") {
            Ok(())
        } else {
            Err(AgentError::Project(first_line(&out.stderr, &out.stdout)))
        }
    }

    async fn start(
        &self,
        folder: &Path,
        title: &str,
        message: &str,
    ) -> Result<TurnResult, AgentError> {
        let folder = folder.to_string_lossy();
        let args = [
            "thread",
            "start",
            folder.as_ref(),
            "-",
            "--provider",
            self.provider.as_str(),
            "--model",
            self.model.as_str(),
            "--title",
            title,
            "--wait",
            "--json",
        ];
        let out = self.run(&args, Some(message), self.timeout).await?;
        parse_turn(out.exit, &out.stdout, &out.stderr)
    }

    async fn send(&self, thread_id: &str, message: &str) -> Result<TurnResult, AgentError> {
        let args = ["thread", "send", thread_id, "-", "--wait", "--json"];
        let out = self.run(&args, Some(message), self.timeout).await?;
        parse_turn(out.exit, &out.stdout, &out.stderr)
    }

    async fn list(&self, folder: &Path) -> Result<Vec<ThreadInfo>, AgentError> {
        let folder = folder.to_string_lossy();
        let out = self
            .run(
                &["thread", "list", "--project", folder.as_ref(), "--json"],
                None,
                QUICK,
            )
            .await?;
        if out.exit != Some(0) {
            return Err(AgentError::BadOutput {
                exit: out.exit,
                detail: first_line(&out.stderr, &out.stdout),
            });
        }
        parse_list(&out.stdout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_finished_turn() {
        let out = r#"{"threadId":"mcp:7e66","runId":"run:1","status":"completed","reply":"PINEAPPLE 2 + 2 = 4","error":null}"#;
        assert_eq!(
            parse_turn(Some(0), out, "").unwrap(),
            TurnResult {
                thread_id: "mcp:7e66".into(),
                outcome: TurnOutcome::Replied("PINEAPPLE 2 + 2 = 4".into())
            }
        );
    }

    #[test]
    fn ignores_log_lines_before_the_json() {
        let out = "Starting…\n{\"threadId\":\"t1\",\"status\":\"completed\",\"reply\":\"hi\",\"error\":null}\n";
        assert_eq!(
            parse_turn(Some(0), out, "").unwrap().outcome,
            TurnOutcome::Replied("hi".into())
        );
    }

    #[test]
    fn failed_and_waiting_runs_keep_the_thread_id() {
        let failed = r#"{"threadId":"t1","status":"failed","reply":null,"error":"rate limited"}"#;
        assert_eq!(
            parse_turn(Some(1), failed, "").unwrap(),
            TurnResult {
                thread_id: "t1".into(),
                outcome: TurnOutcome::Failed("rate limited".into())
            }
        );
        let waiting = r#"{"threadId":"t1","status":"waiting","reply":null,"error":null}"#;
        assert_eq!(
            parse_turn(Some(2), waiting, "").unwrap().outcome,
            TurnOutcome::NeedsAnswer
        );
    }

    #[test]
    fn an_empty_reply_is_a_failure_not_silence() {
        let out = r#"{"threadId":"t1","status":"completed","reply":"  ","error":null}"#;
        assert!(matches!(
            parse_turn(Some(0), out, "").unwrap().outcome,
            TurnOutcome::Failed(_)
        ));
    }

    #[test]
    fn crashes_and_garbage_are_errors() {
        let err =
            parse_turn(Some(1), "", "ERROR\n  The environment rejected the request").unwrap_err();
        assert_eq!(
            err,
            AgentError::BadOutput {
                exit: Some(1),
                detail: "ERROR".into()
            }
        );
        assert!(parse_turn(None, "", "").is_err(), "killed by a signal");
        assert!(parse_turn(Some(0), "not json", "").is_err());
    }

    #[test]
    fn reads_effort_from_codex_config() {
        let toml = "model = \"gpt-6-sol\"\nmodel_reasoning_effort = \"medium\"\n[profiles.x]\nmodel_reasoning_effort = \"high\"\n";
        assert_eq!(codex_config_effort(toml).as_deref(), Some("medium"));
        assert_eq!(
            codex_config_effort("[a]\nmodel_reasoning_effort = \"high\""),
            None,
            "only top level"
        );
        assert_eq!(codex_config_effort("model = \"x\""), None);
    }

    #[test]
    fn only_uuids_count_as_project_ids() {
        assert!(is_project_id("c8b83136-53e8-401b-8de5-85361fc43bcd"));
        for bad in [
            "/Users/ashrith/Desktop/herbot",
            ".",
            "c8b83136-53e8-401b-8de5-85361fc43bc",
            "c8b83136x53e8-401b-8de5-85361fc43bcd",
            "",
        ] {
            assert!(!is_project_id(bad), "{bad}");
        }
    }

    #[test]
    fn parses_thread_lists() {
        let out = r#"[{"threadId":"a","title":"Herbot › Testing","link":"https://app.t3.codes/threads/e/a","status":"completed"},{"threadId":"b","title":"x"}]"#;
        let threads = parse_list(out).unwrap();
        assert_eq!(threads[0].thread_id, "a");
        assert_eq!(
            threads[0].link.as_deref(),
            Some("https://app.t3.codes/threads/e/a")
        );
        assert_eq!(threads[1].link, None);
    }
}
