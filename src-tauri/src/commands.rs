use serde_json::Value;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::path::BaseDirectory;
use tauri::Manager;

#[tauri::command]
pub async fn analyze_image(app: tauri::AppHandle, input: Value) -> Result<Value, String> {
    run_python_command(&app, "analyze-image", input)
}

#[tauri::command]
pub async fn generate_descriptions(
    app: tauri::AppHandle,
    project: Value,
    provider_config: Value,
) -> Result<Value, String> {
    run_python_command(
        &app,
        "generate-descriptions",
        serde_json::json!({
            "project": project,
            "providerConfig": provider_config
        }),
    )
}

#[tauri::command]
pub async fn export_project(
    app: tauri::AppHandle,
    project: Value,
    export_settings: Value,
) -> Result<Value, String> {
    run_python_command(
        &app,
        "export-project",
        serde_json::json!({
            "project": project,
            "exportSettings": export_settings
        }),
    )
}

fn run_python_command(
    app: &tauri::AppHandle,
    subcommand: &str,
    payload: Value,
) -> Result<Value, String> {
    let script_path = resolve_script_path(app)?;
    let (program, args) = resolve_python_command()?;
    let python_log_path = resolve_python_log_path(app)?;

    log::info!("starting python command `{subcommand}` with runtime `{program}`");

    let mut command = Command::new(&program);
    command
        .args(args)
        .arg(script_path)
        .arg(subcommand)
        .env("SPRITESPLIT_PYTHON_LOG", &python_log_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start python command `{program}`: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|error| format!("failed to write payload to python stdin: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for python command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!("python command `{subcommand}` failed: {stderr}");
        return Err(if stderr.is_empty() {
            format!("python command exited with status {}", output.status)
        } else {
            stderr
        });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        log::info!("python command `{subcommand}` stderr: {stderr}");
    }
    log::info!("finished python command `{subcommand}`");

    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("failed to parse python JSON output: {error}"))
}

fn resolve_script_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dev_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("python")
        .join("spritesplit_core.py");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    app.path()
        .resolve("python/spritesplit_core.py", BaseDirectory::Resource)
        .map_err(|error| format!("failed to resolve bundled python script: {error}"))
}

fn resolve_python_log_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("failed to resolve app log dir: {error}"))?;
    fs::create_dir_all(&log_dir).map_err(|error| {
        format!(
            "failed to create app log dir `{}`: {error}",
            log_dir.display()
        )
    })?;
    Ok(log_dir.join("SpriteSplit-python.log"))
}

fn resolve_python_command() -> Result<(String, Vec<String>), String> {
    let mut candidates: Vec<(String, Vec<String>)> = Vec::new();

    if let Ok(explicit) = env::var("SPRITESPLIT_PYTHON") {
        candidates.push((explicit, Vec::new()));
    }

    let local_venv = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".venv")
        .join("Scripts")
        .join("python.exe");
    if local_venv.exists() {
        candidates.push((local_venv.to_string_lossy().to_string(), Vec::new()));
    }

    let local_unix_venv = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".venv")
        .join("bin")
        .join("python");
    if local_unix_venv.exists() {
        candidates.push((local_unix_venv.to_string_lossy().to_string(), Vec::new()));
    }

    if let Ok(user_profile) = env::var("USERPROFILE") {
        let codex_runtime = Path::new(&user_profile)
            .join(".cache")
            .join("codex-runtimes")
            .join("codex-primary-runtime")
            .join("dependencies")
            .join("python")
            .join("python.exe");
        if codex_runtime.exists() {
            candidates.push((codex_runtime.to_string_lossy().to_string(), Vec::new()));
        }
    }

    if let Ok(home) = env::var("HOME") {
        let codex_runtime = Path::new(&home)
            .join(".cache")
            .join("codex-runtimes")
            .join("codex-primary-runtime")
            .join("dependencies")
            .join("python")
            .join("bin")
            .join("python3");
        if codex_runtime.exists() {
            candidates.push((codex_runtime.to_string_lossy().to_string(), Vec::new()));
        }
    }

    for program in [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
    ] {
        candidates.push((program.to_string(), Vec::new()));
    }
    candidates.push(("py".to_string(), vec!["-3".to_string()]));

    for (program, args) in candidates {
        if command_has_supported_version(&program, &args) {
            return Ok((program, args));
        }
    }

    Err(
        "No usable Python runtime found. Set SPRITESPLIT_PYTHON to a Python 3.10+ executable."
            .to_string(),
    )
}

fn command_has_supported_version(program: &str, args: &[String]) -> bool {
    let mut command = Command::new(program);
    command.args(args).arg("--version");
    let output = match command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return false,
    };

    let version_text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    parse_python_version(&version_text)
        .map(|(major, minor)| major > 3 || (major == 3 && minor >= 10))
        .unwrap_or(false)
}

fn parse_python_version(version_text: &str) -> Option<(u32, u32)> {
    let version = version_text.split_whitespace().find(|part| {
        part.chars()
            .next()
            .map(|character| character.is_ascii_digit())
            .unwrap_or(false)
    })?;
    let mut parts = version.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    Some((major, minor))
}
