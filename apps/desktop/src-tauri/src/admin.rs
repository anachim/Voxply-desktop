#![allow(dead_code)]
use crate::state::{active_session, AppState};
use crate::types::{
    HubBranding, HubIcon, HubSettings, InfoResponse, MeInfo, PendingUser, RoleCategory, RoleInfo,
    UserInfo,
};
use tauri::{AppHandle, Emitter, State};

// ---------------------------------------------------------------------------
// User list — with transparent reauth on 401
// ---------------------------------------------------------------------------

/// The hub's `USERS_MAX_LIMIT`; asking for more is clamped server-side.
const USERS_PAGE_SIZE: usize = 500;
// ponytail: bounded so a server that stopped advancing the cursor cannot spin
// here. The keyset uses a strict `>`, so it cannot legitimately repeat a row.
const USERS_MAX_PAGES: usize = 40;

async fn fetch_users_page(
    client: &reqwest::Client,
    hub_url: &str,
    token: &str,
    cursor: Option<&str>,
) -> Result<reqwest::Response, String> {
    let mut req = client
        .get(format!("{hub_url}/users"))
        .bearer_auth(token)
        .query(&[("limit", USERS_PAGE_SIZE.to_string())]);
    if let Some(c) = cursor {
        req = req.query(&[("cursor", c)]);
    }
    req.send().await.map_err(|e| format!("Failed: {e}"))
}

/// The full member roster. `GET /users` is paginated (keyset cursor on the
/// previous page's last `public_key`), and the member list wants everyone —
/// so this walks pages until a short one. Stopping at one page and saying
/// nothing is the bug the endpoint's pagination was added to fix, just at a
/// larger number.
#[tauri::command]
pub(crate) async fn list_users(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<UserInfo>, String> {
    let (hub_url, mut token) = active_session(&state)?;
    let client = state.http_client.clone();

    let mut all: Vec<UserInfo> = Vec::new();
    let mut cursor: Option<String> = None;

    for _ in 0..USERS_MAX_PAGES {
        let mut resp = fetch_users_page(&client, &hub_url, &token, cursor.as_deref()).await?;

        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            let active_id = state.active_hub.lock().unwrap().clone();
            let Some(hub_id) = active_id else {
                return Err("Session lost".to_string());
            };
            match crate::ws::reauth_session(&state, &app, &hub_id).await {
                Ok(new_token) => {
                    resp =
                        fetch_users_page(&client, &hub_url, &new_token, cursor.as_deref()).await?;
                    token = new_token;
                }
                Err(e) => {
                    let hubs = state.hubs.lock().unwrap();
                    if let Some(session) = hubs.get(&hub_id) {
                        let _ = app.emit(
                            "hub-session-lost",
                            serde_json::json!({
                                "hub_id": session.hub_id,
                                "hub_name": session.hub_name,
                            }),
                        );
                    }
                    return Err(format!("Session lost: {e}"));
                }
            }
        }

        let page: Vec<UserInfo> = resp.json().await.map_err(|e| format!("Invalid: {e}"))?;
        let short = page.len() < USERS_PAGE_SIZE;
        cursor = page.last().map(|u| u.public_key.clone());
        all.extend(page);
        if short || cursor.is_none() {
            return Ok(all);
        }
    }

    eprintln!(
        "list_users: stopped at {USERS_MAX_PAGES} pages ({} members)",
        all.len()
    );
    Ok(all)
}

// ---------------------------------------------------------------------------
// Profile / me
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn get_me(state: State<'_, AppState>) -> Result<MeInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    client
        .get(format!("{hub_url}/me"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

// ---------------------------------------------------------------------------
// Hub branding
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn get_hub_branding(state: State<'_, AppState>) -> Result<HubBranding, String> {
    let (hub_url, _) = active_session(&state)?;
    let client = state.http_client.clone();
    let info: InfoResponse = client
        .get(format!("{hub_url}/info"))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))?;
    Ok(HubBranding {
        name: info.name,
        description: info.description,
        icon: info.icon,
        welcome_label: info.welcome_label,
        farewell_label: info.farewell_label,
        welcome_invite_url: info.welcome_invite_url,
        timezone: info.timezone,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_hub_branding(
    name: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    require_approval: Option<bool>,
    min_security_level: Option<u32>,
    max_channel_depth: Option<u32>,
    welcome_label: Option<String>,
    farewell_label: Option<String>,
    welcome_invite_url: Option<String>,
    default_invite_role_id: Option<String>,
    timezone: Option<String>,
    birthdays_enabled: Option<bool>,
    afk_channel_id: Option<String>,
    afk_timeout_secs: Option<u32>,
    name_color_mode: Option<String>,
    max_attachment_bytes: Option<u64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .patch(format!("{hub_url}/hub"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "name": name,
            "description": description,
            "icon": icon,
            "require_approval": require_approval,
            "min_security_level": min_security_level,
            "max_channel_depth": max_channel_depth,
            "welcome_label": welcome_label,
            "farewell_label": farewell_label,
            "welcome_invite_url": welcome_invite_url,
            "default_invite_role_id": default_invite_role_id,
            "timezone": timezone,
            "birthdays_enabled": birthdays_enabled,
            "afk_channel_id": afk_channel_id,
            "afk_timeout_secs": afk_timeout_secs,
            "name_color_mode": name_color_mode,
            "max_attachment_bytes": max_attachment_bytes,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }

    if let Some(active_id) = state.active_hub.lock().unwrap().clone() {
        if let Some(s) = state.hubs.lock().unwrap().get_mut(&active_id) {
            if let Some(new_name) = name {
                s.hub_name = new_name;
            }
            if let Some(new_icon) = icon {
                s.hub_icon = if new_icon.is_empty() {
                    None
                } else {
                    Some(new_icon)
                };
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn list_roles(state: State<'_, AppState>) -> Result<Vec<RoleInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    client
        .get(format!("{hub_url}/roles"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn create_role(
    name: String,
    permissions: Vec<String>,
    priority: i64,
    display_separately: Option<bool>,
    color: Option<String>,
    icon: Option<String>,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<RoleInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let mut body = serde_json::json!({
        "name": name,
        "permissions": permissions,
        "priority": priority,
        "display_separately": display_separately.unwrap_or(false),
    });
    // The hub's role-appearance fields use a tri-state deserializer where a
    // JSON-present `null` means "clear" — unlike this file's other Option<T>
    // params, we must omit these keys entirely (not send `null`) when the
    // caller didn't touch them, or every create would blank any appearance
    // fields the caller wasn't setting.
    let obj = body.as_object_mut().unwrap();
    if let Some(c) = color {
        obj.insert("color".to_string(), serde_json::Value::String(c));
    }
    if let Some(i) = icon {
        obj.insert("icon".to_string(), serde_json::Value::String(i));
    }
    if let Some(c) = category_id {
        obj.insert("category_id".to_string(), serde_json::Value::String(c));
    }
    let resp = client
        .post(format!("{hub_url}/roles"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_role(
    role_id: String,
    name: Option<String>,
    permissions: Option<Vec<String>>,
    priority: Option<i64>,
    display_separately: Option<bool>,
    color: Option<String>,
    icon: Option<String>,
    category_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<RoleInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let mut body = serde_json::json!({
        "name": name,
        "permissions": permissions,
        "priority": priority,
        "display_separately": display_separately,
    });
    // See create_role: only send appearance keys the caller actually set —
    // Tauri collapses "omitted" and "explicit null" into the same `None`
    // here, so an always-present `null` would silently clear the role's
    // color/icon/category on every unrelated update (e.g. a permission toggle).
    let obj = body.as_object_mut().unwrap();
    if let Some(c) = color {
        obj.insert("color".to_string(), serde_json::Value::String(c));
    }
    if let Some(i) = icon {
        obj.insert("icon".to_string(), serde_json::Value::String(i));
    }
    if let Some(c) = category_id {
        obj.insert("category_id".to_string(), serde_json::Value::String(c));
    }
    let resp = client
        .patch(format!("{hub_url}/roles/{role_id}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn delete_role(role_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!("{hub_url}/roles/{role_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_user_roles(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<Vec<RoleInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/users/{target_public_key}/roles"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn assign_role(
    target_public_key: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .put(format!(
            "{hub_url}/users/{target_public_key}/roles/{role_id}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn unassign_role(
    target_public_key: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!(
            "{hub_url}/users/{target_public_key}/roles/{role_id}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Role categories (display-only grouping containers for roles)
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn list_role_categories(
    state: State<'_, AppState>,
) -> Result<Vec<RoleCategory>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    client
        .get(format!("{hub_url}/role-categories"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn create_role_category(
    name: String,
    position: i64,
    state: State<'_, AppState>,
) -> Result<RoleCategory, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/role-categories"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "name": name, "position": position }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn update_role_category(
    category_id: String,
    name: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    position: Option<i64>,
    state: State<'_, AppState>,
) -> Result<RoleCategory, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    // Tri-state fields on the hub side (`Some(None)` clears, absent leaves
    // untouched) — Tauri collapses "omitted" and "explicit null" into the
    // same `None`, so only send keys the caller actually set (same pattern
    // as create_role/update_role's color/icon/category_id above).
    let mut body = serde_json::json!({});
    let obj = body.as_object_mut().unwrap();
    if let Some(n) = name {
        obj.insert("name".to_string(), serde_json::Value::String(n));
    }
    if let Some(c) = color {
        obj.insert("color".to_string(), serde_json::Value::String(c));
    }
    if let Some(i) = icon {
        obj.insert("icon".to_string(), serde_json::Value::String(i));
    }
    if let Some(p) = position {
        obj.insert("position".to_string(), serde_json::json!(p));
    }
    let resp = client
        .patch(format!("{hub_url}/role-categories/{category_id}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn delete_role_category(
    category_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!("{hub_url}/role-categories/{category_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Hub settings / members / icons
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn get_hub_settings(state: State<'_, AppState>) -> Result<HubSettings, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/hub/settings"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn list_pending_members(
    state: State<'_, AppState>,
) -> Result<Vec<PendingUser>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    crate::paging::fetch_all_pages_as(
        &client,
        &token,
        &format!("{hub_url}/hub/pending"),
        "public_key",
        "list_pending_members",
    )
    .await
}

#[tauri::command]
pub(crate) async fn approve_member(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/hub/pending/{target_public_key}/approve"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_hub_icons(state: State<'_, AppState>) -> Result<Vec<HubIcon>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/hub/icons"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json::<Vec<HubIcon>>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

#[tauri::command]
pub(crate) async fn create_hub_icon(
    name: String,
    svg_content: String,
    state: State<'_, AppState>,
) -> Result<HubIcon, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/hub/icons"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "name": name, "svg_content": svg_content }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json::<HubIcon>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

#[tauri::command]
pub(crate) async fn rename_hub_icon(
    icon_id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .patch(format!("{hub_url}/hub/icons/{icon_id}"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "name": name }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn delete_hub_icon(
    icon_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!("{hub_url}/hub/icons/{icon_id}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Member admin structs + moderation
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct MemberAdminInfo {
    pub public_key: String,
    pub display_name: Option<String>,
    pub online: bool,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub roles: Vec<RoleInfo>,
}

#[tauri::command]
pub(crate) async fn list_hub_members(
    state: State<'_, AppState>,
) -> Result<Vec<MemberAdminInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/hub/members"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

pub(crate) async fn post_moderation(
    state: &State<'_, AppState>,
    path: &str,
    body: serde_json::Value,
) -> Result<(), String> {
    let (hub_url, token) = active_session(state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/{path}"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn kick_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(
        &state,
        "moderation/kick",
        serde_json::json!({
            "target_public_key": target_public_key,
            "reason": reason,
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn ban_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(
        &state,
        "moderation/bans",
        serde_json::json!({
            "target_public_key": target_public_key,
            "reason": reason,
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn report_message(
    message_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(
        &state,
        &format!("messages/{message_id}/report"),
        serde_json::json!({ "reason": reason }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn mute_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(
        &state,
        "moderation/mutes",
        serde_json::json!({
            "target_public_key": target_public_key,
            "reason": reason,
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn timeout_user_cmd(
    target_public_key: String,
    duration_seconds: u64,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(
        &state,
        "moderation/timeout",
        serde_json::json!({
            "target_public_key": target_public_key,
            "duration_seconds": duration_seconds,
            "reason": reason,
        }),
    )
    .await
}

/// Mirrors the hub's `ChannelBanByPubkeyResponse`. Desktop used to call a
/// second set of routes under `/moderation/channels/{id}/bans` that wrote the
/// same table under different field names and a weaker permission gate; those
/// were folded into `/channels/{id}/bans` on the hub (2026-08-08).
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct ChannelBanInfo {
    pub channel_id: String,
    pub pubkey: String,
    pub banned_by: String,
    pub reason: Option<String>,
    pub banned_at: i64,
}

#[tauri::command]
pub(crate) async fn channel_ban_user(
    channel_id: String,
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/channels/{channel_id}/bans"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "pubkey": target_public_key,
            "reason": reason,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn channel_unban_user(
    channel_id: String,
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!(
            "{hub_url}/channels/{channel_id}/bans/{target_public_key}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_channel_bans(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChannelBanInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/channels/{channel_id}/bans"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

// ---------------------------------------------------------------------------
// Channel permission overwrites (Nested Channels §3.6)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
pub(crate) struct ChannelOverwriteSet {
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct ChannelRolePermissionsView {
    pub role_id: String,
    pub role_name: String,
    pub overwrites: ChannelOverwriteSet,
    pub inherited: Vec<String>,
    pub effective: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct ChannelPermissionsResponse {
    pub channel_id: String,
    pub roles: Vec<ChannelRolePermissionsView>,
}

#[tauri::command]
pub(crate) async fn get_channel_permissions(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<ChannelPermissionsResponse, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/channels/{channel_id}/permissions"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn set_channel_role_permissions(
    channel_id: String,
    role_id: String,
    allow: Vec<String>,
    deny: Vec<String>,
    state: State<'_, AppState>,
) -> Result<ChannelRolePermissionsView, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .put(format!(
            "{hub_url}/channels/{channel_id}/permissions/{role_id}"
        ))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "allow": allow, "deny": deny }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn clear_channel_role_permissions(
    channel_id: String,
    role_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!(
            "{hub_url}/channels/{channel_id}/permissions/{role_id}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct VoiceMuteInfo {
    pub target_public_key: String,
    pub muted_by: String,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub(crate) async fn voice_mute_user_cmd(
    target_public_key: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    post_moderation(
        &state,
        "moderation/voice-mutes",
        serde_json::json!({
            "target_public_key": target_public_key,
            "reason": reason,
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn voice_unmute_user_cmd(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!(
            "{hub_url}/moderation/voice-mutes/{target_public_key}"
        ))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_voice_mutes(
    state: State<'_, AppState>,
) -> Result<Vec<VoiceMuteInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/moderation/voice-mutes"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct TalkPowerInfo {
    pub channel_id: String,
    pub min_talk_power: i64,
}

#[tauri::command]
pub(crate) async fn get_talk_power(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<TalkPowerInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .get(format!("{hub_url}/channels/{channel_id}/talk-power"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn set_talk_power_cmd(
    channel_id: String,
    min_talk_power: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/channels/{channel_id}/talk-power"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "min_talk_power": min_talk_power }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Bans + invites
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct BanInfo {
    pub target_public_key: String,
    pub banned_by: String,
    pub reason: Option<String>,
    pub created_at: i64,
}

#[tauri::command]
pub(crate) async fn list_bans(state: State<'_, AppState>) -> Result<Vec<BanInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    crate::paging::fetch_all_pages_as(
        &client,
        &token,
        &format!("{hub_url}/moderation/bans"),
        "target_public_key",
        "list_bans",
    )
    .await
}

#[tauri::command]
pub(crate) async fn unban_user(
    target_public_key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!("{hub_url}/moderation/bans/{target_public_key}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub(crate) struct InviteInfo {
    pub code: String,
    pub created_by: String,
    pub max_uses: Option<i64>,
    pub uses: i64,
    pub expires_at: Option<i64>,
    pub created_at: i64,
    #[serde(default)]
    pub grant_role_id: Option<String>,
}

#[tauri::command]
pub(crate) async fn list_invites(state: State<'_, AppState>) -> Result<Vec<InviteInfo>, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    crate::paging::fetch_all_pages_as(
        &client,
        &token,
        &format!("{hub_url}/invites"),
        "code",
        "list_invites",
    )
    .await
}

#[tauri::command]
pub(crate) async fn create_invite(
    max_uses: Option<i64>,
    expires_in_seconds: Option<i64>,
    grant_role_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<InviteInfo, String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .post(format!("{hub_url}/invites"))
        .bearer_auth(&token)
        .json(&serde_json::json!({
            "max_uses": max_uses,
            "expires_in_seconds": expires_in_seconds,
            "grant_role_id": grant_role_id,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json().await.map_err(|e| format!("Invalid: {e}"))
}

#[tauri::command]
pub(crate) async fn revoke_invite(code: String, state: State<'_, AppState>) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let client = state.http_client.clone();
    let resp = client
        .delete(format!("{hub_url}/invites/{code}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// User profile card (hub_url parameterized)
// ---------------------------------------------------------------------------

#[tauri::command]
pub(crate) async fn get_user_profile(
    hub_url: String,
    pubkey: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let token = crate::state::session_for_url(&state, &hub_url)?;
    let url = format!(
        "{}/members/{}/profile",
        hub_url.trim_end_matches('/'),
        pubkey
    );
    let res = state
        .http_client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    res.json().await.map_err(|e| e.to_string())
}

/// PATCH /me on a hub identified by URL rather than "whichever is active" —
/// the shared profile editor (packages/ui ProfileEditorSection) can write to
/// any joined hub with a live session, not just the active one.
#[tauri::command]
pub(crate) async fn update_my_profile_on_hub(
    hub_url: String,
    profile: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = crate::state::session_for_url(&state, &hub_url)?;
    let resp = state
        .http_client
        .patch(format!("{}/me", hub_url.trim_end_matches('/')))
        .bearer_auth(&token)
        .json(&profile)
        .send()
        .await
        .map_err(|e| format!("Failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Content reports (moderation queue)
//
// Web has had these since the moderation suite shipped; desktop had no surface
// for them at all, so a moderator on desktop could not see what members had
// flagged. Parity pass 2026-09-08 — the UI is the shared
// `ContentReportsSection`, and this is the transport half.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct Report {
    pub id: String,
    pub message_id: String,
    pub message_content: Option<String>,
    pub channel_id: String,
    pub reporter_pubkey: String,
    pub reason: String,
    pub reported_at: i64,
    pub status: String,
}

#[tauri::command]
pub(crate) async fn list_reports(
    status: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<Report>, String> {
    let (hub_url, token) = active_session(&state)?;
    let base = hub_url.trim_end_matches('/');
    // The vocabulary is ours ("pending", "reviewed"), so this validates rather
    // than escapes: anything else is a caller bug, and silently encoding it
    // would send the hub a filter nobody meant.
    let query = match status.as_deref() {
        None | Some("") => String::new(),
        Some(s) if s.chars().all(|c| c.is_ascii_lowercase() || c == '_') => {
            format!("?status={s}")
        }
        Some(other) => return Err(format!("unsupported report status: {other}")),
    };
    let resp = state
        .http_client
        .get(format!("{base}/admin/reports{query}"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))
}

#[tauri::command]
pub(crate) async fn review_report(
    report_id: String,
    action: String,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let base = hub_url.trim_end_matches('/');
    let resp = state
        .http_client
        .post(format!("{base}/admin/reports/{report_id}/review"))
        .bearer_auth(&token)
        .json(&serde_json::json!({ "action": action, "note": note }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub(crate) struct ModerationSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,
    pub webhook_secret_set: bool,
    pub circuit_open: bool,
    pub circuit_open_until: Option<i64>,
}

#[tauri::command]
pub(crate) async fn get_moderation_settings(
    state: State<'_, AppState>,
) -> Result<ModerationSettings, String> {
    let (hub_url, token) = active_session(&state)?;
    let base = hub_url.trim_end_matches('/');
    let resp = state
        .http_client
        .get(format!("{base}/admin/settings/moderation"))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    resp.json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))
}

/// Tri-state PATCH, and the reason this builds its body by hand: Tauri gives
/// the same `None` for an argument the caller omitted and one it passed as
/// null, while this endpoint reads an **absent** field as "leave it alone" and
/// an empty string as "clear it". Serializing the Options directly would send
/// `webhook_url: null` for an untouched field, and saving a secret alone would
/// wipe the URL. (clients CLAUDE.md, the omitted-vs-null trap — it has bitten
/// role colour/icon and banner sources before.)
#[tauri::command]
pub(crate) async fn set_moderation_settings(
    webhook_url: Option<String>,
    webhook_secret: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (hub_url, token) = active_session(&state)?;
    let base = hub_url.trim_end_matches('/');

    let mut body = serde_json::Map::new();
    if let Some(url) = webhook_url {
        body.insert("webhook_url".into(), serde_json::Value::String(url));
    }
    if let Some(secret) = webhook_secret {
        body.insert("webhook_secret".into(), serde_json::Value::String(secret));
    }

    let resp = state
        .http_client
        .patch(format!("{base}/admin/settings/moderation"))
        .bearer_auth(&token)
        .json(&serde_json::Value::Object(body))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(resp.text().await.unwrap_or_default());
    }
    Ok(())
}
