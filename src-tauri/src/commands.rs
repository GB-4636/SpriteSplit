use serde_json::Value;
use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::path::BaseDirectory;

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

fn run_python_command(app: &tauri::AppHandle, subcommand: &str, payload: Value) -> Result<Value, String> {
    let script_path = resolve_script_path(app)?;
    let (program, args) = resolve_python_command()?;

    let mut command = Command::new(&program);
    command
        .args(args)
        .arg(script_path)
        .arg(subcommand)
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
        return Err(if stderr.is_empty() {
            format!("python command exited with status {}", output.status)
        } else {
            stderr
        });
    }

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

    candidates.push(("python".to_string(), Vec::new()));
    candidates.push(("py".to_string(), vec!["-3".to_string()]));

    for (program, args) in candidates {
        if command_available(&program, &args) {
            return Ok((program, args));
        }
    }

    Err(
        "No usable Python runtime found. Set SPRITESPLIT_PYTHON to a Python 3.10+ executable."
            .to_string(),
    )
}

fn command_available(program: &str, args: &[String]) -> bool {
    let mut command = Command::new(program);
    command.args(args).arg("--version");
    command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}
