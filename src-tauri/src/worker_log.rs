use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use swarm_state::swarm_db_path;

/// Cap per-poll read so we never balloon the IPC payload when a worker dumps
/// a large amount of stdout at once. The frontend keeps polling until it
/// catches up.
const MAX_CHUNK_BYTES: u64 = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct WorkerLogChunk {
    pub data: String,
    pub from_offset: u64,
    pub new_offset: u64,
    pub size: u64,
    pub eof: bool,
    pub truncated: bool,
}

fn worker_logs_root() -> Result<PathBuf, String> {
    let dir = swarm_db_path()?
        .parent()
        .map_or_else(|| PathBuf::from(".swarm-mcp"), Path::to_path_buf);
    Ok(dir.join("worker-logs"))
}

fn validate_path(input: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(input);
    if !candidate.is_absolute() {
        return Err(format!("worker log path must be absolute: {input}"));
    }
    let canonical = candidate
        .canonicalize()
        .map_err(|err| format!("worker log path is not readable: {err}"))?;
    let root = worker_logs_root()?
        .canonicalize()
        .map_err(|err| format!("worker log root is unavailable: {err}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "worker log path is outside {}: {input}",
            root.display()
        ));
    }
    Ok(canonical)
}

#[tauri::command]
pub fn worker_log_read(path: String, from_offset: u64) -> Result<WorkerLogChunk, String> {
    let resolved = validate_path(&path)?;
    let mut file =
        std::fs::File::open(&resolved).map_err(|err| format!("worker log open failed: {err}"))?;
    let total = file
        .metadata()
        .map_err(|err| format!("worker log stat failed: {err}"))?
        .len();

    if from_offset >= total {
        return Ok(WorkerLogChunk {
            data: String::new(),
            from_offset,
            new_offset: total,
            size: total,
            eof: true,
            truncated: false,
        });
    }

    file.seek(SeekFrom::Start(from_offset))
        .map_err(|err| format!("worker log seek failed: {err}"))?;
    let remaining = total - from_offset;
    let to_read = remaining.min(MAX_CHUNK_BYTES);
    let mut buffer = vec![0u8; to_read as usize];
    file.read_exact(&mut buffer)
        .map_err(|err| format!("worker log read failed: {err}"))?;
    let new_offset = from_offset + to_read;
    let data = String::from_utf8_lossy(&buffer).into_owned();
    Ok(WorkerLogChunk {
        data,
        from_offset,
        new_offset,
        size: total,
        eof: new_offset >= total,
        truncated: remaining > MAX_CHUNK_BYTES,
    })
}
