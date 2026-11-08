use tracing_subscriber::EnvFilter;

use crate::config::LogFormat;

/// Installs the global tracing subscriber. `RUST_LOG` overrides the default filter.
pub fn init(format: LogFormat) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,herbot_core=debug,tower_http=info"));

    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true);
    match format {
        LogFormat::Json => builder.json().flatten_event(true).init(),
        LogFormat::Pretty => builder.pretty().init(),
    }
}
