// Wavvon desktop Tauri shell — composition root.
// All domain logic lives in the modules below. This file wires them together.

mod accounts;
mod admin;
mod admin_alliance;
mod auth_creds;
mod backup;
mod bots;
mod certs;
mod channels;
mod deep_link;
mod devices;
mod discovery;
mod dm;
mod events_polls;
mod home_hub;
mod hub_session;
mod identity;
mod identity_cmd;
mod lobby;
mod local_store;
mod messages;
mod mini_app;
mod paging;
mod pairing;
mod passkey_cmd;
mod prefs_blob;
mod recovery;
mod screen_share;
mod soundboard;
mod state;
mod types;
mod updater;
mod voice_cmd;
mod voice_keys;
mod ws;

use tauri::Manager;

use state::{AppState, PendingUpdate};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(AppState {
                hubs: Default::default(),
                active_hub: Default::default(),
                voice: Default::default(),
                http_client: reqwest::Client::new(),
            });
            app.manage(PendingUpdate(std::sync::Mutex::new(None)));
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(updater::check_for_updates(update_handle));

            let show = MenuItem::with_id(app, "show", "Show Wavvon", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Wavvon")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::TrayIconEvent;
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            if let Some(w) = tray.app_handle().get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Hub session
            hub_session::add_hub,
            hub_session::list_hubs,
            hub_session::ping_hub,
            hub_session::set_active_hub,
            hub_session::remove_hub,
            hub_session::auto_connect_saved,
            hub_session::reconnect_hub,
            hub_session::reorder_hubs,
            hub_session::preview_hub_info,
            hub_session::get_hub_ws_info,
            // Channels
            channels::list_channels,
            channels::list_hub_emojis,
            channels::create_channel,
            channels::update_channel_description,
            channels::rename_channel,
            channels::move_channel,
            channels::update_channel_appearance,
            channels::set_forum_require_tag,
            channels::set_channel_nsfw,
            channels::delete_channel,
            channels::reorder_channels,
            channels::subscribe_channel,
            channels::unsubscribe_channel,
            channels::set_typing,
            channels::set_dm_typing,
            channels::patch_channel_banner_file,
            channels::patch_channel_banner_url,
            // Messages
            messages::get_messages,
            messages::get_thread_replies,
            messages::search_messages,
            messages::search_messages_global,
            messages::add_reaction,
            messages::remove_reaction,
            messages::send_message,
            messages::edit_message,
            messages::delete_message,
            messages::forum_list_posts,
            messages::forum_get_post,
            messages::forum_create_post,
            messages::forum_create_reply,
            messages::forum_pin_post,
            messages::forum_lock_post,
            messages::forum_edit_post,
            messages::forum_delete_post,
            messages::forum_edit_reply,
            messages::forum_delete_reply,
            messages::forum_add_post_reaction,
            messages::forum_remove_post_reaction,
            messages::forum_add_reply_reaction,
            messages::forum_remove_reply_reaction,
            messages::forum_list_tags,
            messages::forum_create_tag,
            messages::forum_edit_tag,
            messages::forum_delete_tag,
            messages::mark_post_read,
            messages::upload_file,
            messages::upload_file_bytes,
            messages::pin_message,
            messages::unpin_message,
            messages::get_pinned_messages,
            // Voice
            voice_cmd::voice_active_users,
            voice_cmd::voice_channel_participants,
            voice_cmd::voice_join,
            voice_cmd::voice_leave,
            voice_cmd::voice_set_muted,
            voice_cmd::voice_set_deafened,
            voice_cmd::list_audio_devices,
            local_store::get_voice_settings,
            local_store::save_voice_settings,
            voice_cmd::set_voice_gain,
            voice_cmd::send_hub_ws_raw,
            voice_cmd::send_hub_ws_raw_to,
            voice_cmd::send_all_hubs_ws_raw,
            voice_cmd::mic_test_start,
            voice_cmd::mic_test_stop,
            voice_cmd::start_whisper,
            voice_cmd::stop_whisper,
            voice_cmd::load_whisper_lists,
            voice_cmd::save_whisper_lists,
            // Soundboard
            soundboard::soundboard_list_clips,
            soundboard::soundboard_fetch_audio,
            soundboard::soundboard_upload_clip,
            soundboard::soundboard_delete_clip,
            soundboard::soundboard_play_clip,
            // Local store
            local_store::load_appearance,
            local_store::save_appearance,
            local_store::clear_local_data,
            local_store::load_unread_state,
            local_store::save_unread_state,
            local_store::load_notification_mutes,
            local_store::save_notification_mutes,
            local_store::load_collapsed_categories,
            local_store::save_collapsed_categories,
            local_store::load_blocked_users,
            local_store::save_blocked_users,
            local_store::load_ignored_users,
            local_store::save_ignored_users,
            local_store::load_whisper_optout,
            local_store::save_whisper_optout,
            local_store::get_profile,
            local_store::save_profile,
            // Admin
            admin::get_banlist_settings,
            admin::get_banlist_entries,
            admin::get_banlist_overrides,
            admin::add_banlist_source,
            admin::remove_banlist_source,
            admin::update_banlist_source_policy,
            admin::add_banlist_override,
            admin::remove_banlist_override,
            admin::set_banlist_publish,
            admin::list_reports,
            admin::get_moderation_settings,
            admin::set_moderation_settings,
            admin::review_report,
            admin::list_users,
            admin::get_me,
            admin::get_hub_branding,
            admin::update_hub_branding,
            admin::list_roles,
            admin::create_role,
            admin::update_role,
            admin::delete_role,
            admin::assign_role,
            admin::unassign_role,
            admin::list_user_roles,
            admin::list_role_categories,
            admin::create_role_category,
            admin::update_role_category,
            admin::delete_role_category,
            admin::get_hub_settings,
            admin::list_pending_members,
            admin::approve_member,
            admin::list_hub_icons,
            admin::create_hub_icon,
            admin::rename_hub_icon,
            admin::delete_hub_icon,
            admin::list_hub_members,
            admin::kick_user_cmd,
            admin::ban_user_cmd,
            admin::report_message,
            admin::mute_user_cmd,
            admin::timeout_user_cmd,
            admin::voice_mute_user_cmd,
            admin::voice_unmute_user_cmd,
            admin::list_voice_mutes,
            admin::channel_ban_user,
            admin::channel_unban_user,
            admin::list_channel_bans,
            admin::get_channel_permissions,
            admin::set_channel_role_permissions,
            admin::clear_channel_role_permissions,
            admin::get_talk_power,
            admin::set_talk_power_cmd,
            admin::list_bans,
            admin::unban_user,
            admin::list_invites,
            admin::create_invite,
            admin::revoke_invite,
            admin::get_user_profile,
            admin::update_my_profile_on_hub,
            // Alliance / federation
            admin_alliance::list_alliances,
            admin_alliance::create_alliance,
            admin_alliance::create_alliance_invite,
            admin_alliance::join_alliance,
            admin_alliance::leave_alliance,
            admin_alliance::send_alliance_push_invite,
            admin_alliance::list_pending_alliance_invites,
            admin_alliance::respond_to_alliance_invite,
            admin_alliance::list_alliance_shared_channels,
            admin_alliance::get_alliance_channel_messages,
            admin_alliance::send_alliance_channel_message,
            admin_alliance::share_channel_with_alliance,
            admin_alliance::unshare_channel_from_alliance,
            // Accounts (multi-account switcher)
            accounts::list_accounts,
            accounts::create_account,
            accounts::switch_account,
            accounts::remove_account,
            accounts::rename_account,
            accounts::reorder_accounts,
            // Identity backup (unified .wavvon-backup, settings-ia.md §4a)
            backup::export_account_backup,
            backup::import_account_backup,
            // Identity
            identity_cmd::get_recovery_phrase,
            identity_cmd::recover_identity_from_phrase,
            identity_cmd::get_my_public_key,
            identity_cmd::get_my_pubkey,
            identity_cmd::fetch_public_profile,
            identity_cmd::submit_to_directory,
            // DM / friends / E2E crypto
            dm::list_friends,
            dm::list_pending_friends,
            dm::send_friend_request,
            dm::accept_friend,
            dm::remove_friend,
            dm::list_conversations,
            dm::create_conversation,
            dm::get_dm_messages,
            dm::send_dm,
            dm::update_dm_blocks,
            dm::publish_dh_key,
            dm::fetch_dh_key,
            dm::push_group_sender_key,
            dm::rotate_group_sender_key,
            dm::fetch_group_sender_keys,
            dm::encrypt_group_dm,
            dm::init_dr_session,
            dm::encrypt_dm_dr,
            // Bots / webhooks
            bots::list_bots,
            bots::send_component_interaction,
            bots::get_bot_profile,
            bots::admin_list_external_bots,
            bots::admin_add_external_bot,
            bots::admin_remove_external_bot,
            bots::admin_get_bot_channel_scope,
            bots::admin_set_bot_channel_scope,
            bots::admin_list_webhooks,
            bots::admin_create_webhook,
            bots::admin_regenerate_webhook,
            bots::admin_delete_webhook,
            // Lobby / challenge / survey
            lobby::lobby_status,
            lobby::lobby_submit_proof,
            lobby::lobby_get_welcome,
            lobby::set_lobby_settings,
            lobby::challenge_fetch,
            lobby::challenge_submit,
            lobby::set_challenge_settings,
            lobby::survey_current,
            lobby::survey_submit,
            lobby::survey_admin_get,
            lobby::survey_admin_put,
            lobby::survey_admin_responses,
            // Identity recovery + key rotation
            recovery::get_recovery_contacts,
            recovery::set_recovery_contacts,
            recovery::remove_recovery_contact,
            recovery::submit_rotation_request,
            recovery::get_rotation_request_bundle,
            recovery::attest_rotation_request,
            // Events and polls
            events_polls::create_event,
            events_polls::vote_poll,
            events_polls::create_poll,
            events_polls::get_channel_polls,
            events_polls::delete_poll,
            events_polls::delete_event,
            events_polls::get_hub_events,
            events_polls::rsvp_event_hub,
            events_polls::create_event_hub,
            events_polls::get_event,
            events_polls::get_event_assignments,
            events_polls::get_event_rsvps,
            events_polls::create_event_squad_rooms,
            // Screen capture / PiP
            screen_share::list_capture_sources,
            screen_share::open_pip_window,
            screen_share::close_pip_window,
            // Mini-app windows
            mini_app::open_mini_app,
            mini_app::close_mini_app,
            // Certs / audit
            certs::get_cert_settings,
            certs::get_audit_log,
            certs::list_issued_certs,
            certs::save_cert_settings,
            certs::issue_cert,
            certs::revoke_cert,
            certs::grant_user_badge,
            certs::fetch_my_certs,
            // Discovery / badges
            discovery::get_discovery_settings,
            discovery::set_discovery_tags,
            discovery::set_hub_listed,
            discovery::fetch_link_preview,
            discovery::list_badges,
            discovery::list_pending_badges,
            discovery::accept_badge,
            discovery::decline_badge,
            discovery::remove_badge,
            discovery::grant_badge,
            // Updater / tray
            updater::install_pending_update,
            updater::set_tray_unread,
            // Deep links
            deep_link::get_pending_deep_link,
            // Pairing / home hub / devices
            home_hub::set_home_hub_list,
            home_hub::get_home_hub_list,
            pairing::start_pairing_offer,
            pairing::poll_pairing_status,
            pairing::complete_pairing,
            pairing::fingerprint_pubkey,
            pairing::parse_pairing_offer,
            pairing::claim_pairing_offer,
            pairing::save_paired_identity,
            pairing::get_paired_identity,
            devices::device_list,
            devices::device_revoke,
            // Passkeys / trusted devices
            passkey_cmd::passkey_list,
            passkey_cmd::passkey_delete,
            passkey_cmd::passkey_rename,
            passkey_cmd::trusted_device_list,
            passkey_cmd::trusted_device_revoke,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ---------------------------------------------------------------------------
// Tests — cover pure helpers that don't need a running AppHandle.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use crate::local_store::{DefaultProfileFields, LocalProfile, StoredVoiceSettings};
    use crate::messages::urlencoding_emoji;
    use crate::types::{default_approval_status, SavedHub};

    #[test]
    fn urlencoding_emoji_passes_unreserved_chars_through() {
        assert_eq!(urlencoding_emoji(""), "");
        assert_eq!(urlencoding_emoji("hello"), "hello");
        assert_eq!(urlencoding_emoji("a-b_c.d~e"), "a-b_c.d~e");
        assert_eq!(urlencoding_emoji("0123456789"), "0123456789");
    }

    #[test]
    fn urlencoding_emoji_percent_encodes_reserved_and_unicode() {
        assert_eq!(urlencoding_emoji(" "), "%20");
        assert_eq!(urlencoding_emoji("a/b"), "a%2Fb");
        assert_eq!(urlencoding_emoji("?&="), "%3F%26%3D");
        assert_eq!(urlencoding_emoji("\u{1F44D}"), "%F0%9F%91%8D");
        assert_eq!(urlencoding_emoji("\u{2764}"), "%E2%9D%A4");
    }

    #[test]
    fn default_approval_status_is_approved() {
        assert_eq!(default_approval_status(), "approved");
    }

    #[test]
    fn local_profile_default_is_empty_with_no_theme() {
        let p = LocalProfile::default();
        assert!(p.default_profile.is_none());
        assert!(p.theme.is_none());
    }

    #[test]
    fn local_profile_round_trips_default_profile_fields() {
        let p = LocalProfile {
            default_profile: Some(DefaultProfileFields {
                display_name: "Alice".to_string(),
                avatar: Some("data:image/png;base64,xx".to_string()),
                bio: Some("hi".to_string()),
                ..Default::default()
            }),
            theme: Some("calm".to_string()),
        };
        let json = serde_json::to_string(&p).unwrap();
        let back: LocalProfile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.default_profile.unwrap().display_name, "Alice");
        assert_eq!(back.theme.as_deref(), Some("calm"));
    }

    #[test]
    fn local_profile_ignores_orphaned_pool_fields_from_before_the_2026_07_12_model() {
        // Alpha rules — no migration (settings-ia.md §5): a pre-convergence
        // profile.json still parses, just with an empty default_profile.
        let old = r#"{"profiles":[{"id":"a","label":"A"}],"default_profile_id":"a"}"#;
        let p: LocalProfile = serde_json::from_str(old).unwrap();
        assert!(p.default_profile.is_none());
    }

    #[test]
    fn saved_hub_round_trips_through_json() {
        let original = SavedHub {
            hub_id: "h1".to_string(),
            hub_name: "Hub One".to_string(),
            hub_url: "https://hub.example".to_string(),
        };
        let json = serde_json::to_string(&original).unwrap();
        let decoded: SavedHub = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.hub_id, original.hub_id);
        assert_eq!(decoded.hub_name, original.hub_name);
        assert_eq!(decoded.hub_url, original.hub_url);
    }

    #[test]
    fn stored_voice_settings_decodes_with_missing_fields() {
        let old: StoredVoiceSettings =
            serde_json::from_str(r#"{"input_device":"mic","vad_threshold":0.05}"#).unwrap();
        assert_eq!(old.input_device.as_deref(), Some("mic"));
        assert_eq!(old.vad_threshold, Some(0.05));
        assert!(old.voice_mode.is_none());
        assert!(old.ptt_key.is_none());
    }

    #[test]
    fn stored_voice_settings_round_trips_full_payload() {
        let s = StoredVoiceSettings {
            input_device: Some("USB Mic".to_string()),
            output_device: Some("Speakers".to_string()),
            vad_threshold: Some(0.02),
            voice_mode: Some("ptt".to_string()),
            ptt_key: Some("Space".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: StoredVoiceSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.input_device, s.input_device);
        assert_eq!(back.output_device, s.output_device);
        assert_eq!(back.vad_threshold, s.vad_threshold);
        assert_eq!(back.voice_mode, s.voice_mode);
        assert_eq!(back.ptt_key, s.ptt_key);
    }

    #[test]
    fn local_profile_decodes_with_missing_theme() {
        let old: LocalProfile = serde_json::from_str(r#"{}"#).unwrap();
        assert!(old.default_profile.is_none());
        assert!(old.theme.is_none());
    }
}
