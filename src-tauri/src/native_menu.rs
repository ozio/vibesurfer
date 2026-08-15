use serde::Deserialize;
use tauri::{
    menu::{
        AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, Menu, MenuItem, MenuItemBuilder,
        PredefinedMenuItem, Submenu,
    },
    AppHandle, Emitter, Runtime, State,
};

pub const NATIVE_MENU_EVENT: &str = "vibesurfer://native-menu";

const NEW_TAB: &str = "new-tab";
const CLOSE_TAB: &str = "close-tab";
const FOCUS_ADDRESS: &str = "focus-address";
const RELOAD: &str = "reload";
const STOP: &str = "stop";
const BACK: &str = "back";
const FORWARD: &str = "forward";
const HOME: &str = "home";
const HISTORY: &str = "history";
const NEXT_TAB: &str = "next-tab";
const PREVIOUS_TAB: &str = "previous-tab";
const REGENERATE: &str = "regenerate";
const REIMAGINE: &str = "reimagine";
const OPEN_LIVE_SITE: &str = "open-live-site";
const HORIZONTAL_TABS: &str = "horizontal-tabs";
const VERTICAL_TABS: &str = "vertical-tabs";
const OPEN_SETTINGS: &str = "open-settings";
const OPEN_GENERATION_SETTINGS: &str = "open-generation-settings";
const OPEN_MODELS: &str = "open-models";
const OPEN_PROFILES: &str = "open-profiles";
const OPEN_GITHUB: &str = "open-github";
const REPORT_ISSUE: &str = "report-issue";

pub struct NativeMenuItems<R: Runtime> {
    back: MenuItem<R>,
    forward: MenuItem<R>,
    stop: MenuItem<R>,
    regenerate: MenuItem<R>,
    reimagine: MenuItem<R>,
    open_live_site: MenuItem<R>,
    horizontal_tabs: CheckMenuItem<R>,
    vertical_tabs: CheckMenuItem<R>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuState {
    can_go_back: bool,
    can_go_forward: bool,
    is_loading: bool,
    is_generated: bool,
    is_archived: bool,
    has_live_site: bool,
    horizontal_tabs: bool,
}

fn command_item<R: Runtime>(
    app: &AppHandle<R>,
    id: &'static str,
    text: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(id, text);
    if let Some(accelerator) = accelerator {
        builder = builder.accelerator(accelerator);
    }
    builder.build(app)
}

pub fn build_native_menu<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<(Menu<R>, NativeMenuItems<R>)> {
    let about = AboutMetadata {
        name: Some("VibeSurfer".into()),
        version: Some(app.package_info().version.to_string()),
        comments: Some("A model-native browser shaped by language models.".into()),
        ..Default::default()
    };

    let settings = command_item(app, OPEN_SETTINGS, "Settings…", Some("CmdOrCtrl+,"))?;
    let app_menu = Submenu::with_items(
        app,
        "VibeSurfer",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About VibeSurfer"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Hide VibeSurfer"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit VibeSurfer"))?,
        ],
    )?;

    let new_tab = command_item(app, NEW_TAB, "New Tab", Some("CmdOrCtrl+T"))?;
    let close_tab = command_item(app, CLOSE_TAB, "Close Tab", Some("CmdOrCtrl+W"))?;
    let file_menu = Submenu::with_items(app, "File", true, &[&new_tab, &close_tab])?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let focus_address = command_item(app, FOCUS_ADDRESS, "Focus Address Bar", Some("CmdOrCtrl+L"))?;
    let reload = command_item(app, RELOAD, "Reload Page", Some("CmdOrCtrl+R"))?;
    let stop = MenuItemBuilder::with_id(STOP, "Stop Loading")
        .accelerator("Esc")
        .enabled(false)
        .build(app)?;
    let horizontal_tabs = CheckMenuItemBuilder::with_id(HORIZONTAL_TABS, "Horizontal Tabs")
        .checked(true)
        .build(app)?;
    let vertical_tabs = CheckMenuItemBuilder::with_id(VERTICAL_TABS, "Vertical Tabs")
        .checked(false)
        .build(app)?;
    let tab_layout =
        Submenu::with_items(app, "Tab Layout", true, &[&horizontal_tabs, &vertical_tabs])?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &focus_address,
            &reload,
            &stop,
            &PredefinedMenuItem::separator(app)?,
            &tab_layout,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let back = MenuItemBuilder::with_id(BACK, "Back")
        .accelerator("CmdOrCtrl+[")
        .enabled(false)
        .build(app)?;
    let forward = MenuItemBuilder::with_id(FORWARD, "Forward")
        .accelerator("CmdOrCtrl+]")
        .enabled(false)
        .build(app)?;
    let home = command_item(app, HOME, "Home", Some("CmdOrCtrl+Shift+H"))?;
    let history = command_item(app, HISTORY, "Show All History", Some("CmdOrCtrl+Y"))?;
    let history_menu = Submenu::with_items(
        app,
        "History",
        true,
        &[
            &back,
            &forward,
            &home,
            &PredefinedMenuItem::separator(app)?,
            &history,
        ],
    )?;

    let regenerate = MenuItemBuilder::with_id(REGENERATE, "Regenerate Page")
        .accelerator("CmdOrCtrl+Shift+R")
        .enabled(false)
        .build(app)?;
    let reimagine = MenuItemBuilder::with_id(REIMAGINE, "Reimagine Site")
        .enabled(false)
        .build(app)?;
    let open_live_site =
        MenuItemBuilder::with_id(OPEN_LIVE_SITE, "Open Live Site in Default Browser")
            .enabled(false)
            .build(app)?;
    let generation_settings =
        command_item(app, OPEN_GENERATION_SETTINGS, "Generation Settings…", None)?;
    let models = command_item(app, OPEN_MODELS, "Models && Codex…", None)?;
    let profiles = command_item(app, OPEN_PROFILES, "Profiles…", None)?;
    let surf_menu = Submenu::with_items(
        app,
        "Surf",
        true,
        &[
            &regenerate,
            &reimagine,
            &open_live_site,
            &PredefinedMenuItem::separator(app)?,
            &generation_settings,
            &models,
            &profiles,
        ],
    )?;

    let previous_tab = command_item(app, PREVIOUS_TAB, "Previous Tab", Some("Ctrl+Shift+Tab"))?;
    let next_tab = command_item(app, NEXT_TAB, "Next Tab", Some("Ctrl+Tab"))?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &previous_tab,
            &next_tab,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;

    let github = command_item(app, OPEN_GITHUB, "VibeSurfer on GitHub", None)?;
    let report_issue = command_item(app, REPORT_ISSUE, "Report an Issue…", None)?;
    let help_menu = Submenu::with_items(app, "Help", true, &[&github, &report_issue])?;

    #[cfg(target_os = "macos")]
    {
        window_menu.set_as_windows_menu_for_nsapp()?;
        help_menu.set_as_help_menu_for_nsapp()?;
    }

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &history_menu,
            &surf_menu,
            &window_menu,
            &help_menu,
        ],
    )?;

    Ok((
        menu,
        NativeMenuItems {
            back,
            forward,
            stop,
            regenerate,
            reimagine,
            open_live_site,
            horizontal_tabs,
            vertical_tabs,
        },
    ))
}

#[tauri::command]
pub fn update_native_menu_state(
    items: State<'_, NativeMenuItems<tauri::Wry>>,
    menu_state: NativeMenuState,
) -> Result<(), String> {
    items
        .back
        .set_enabled(menu_state.can_go_back)
        .map_err(|error| error.to_string())?;
    items
        .forward
        .set_enabled(menu_state.can_go_forward)
        .map_err(|error| error.to_string())?;
    items
        .stop
        .set_enabled(menu_state.is_loading)
        .map_err(|error| error.to_string())?;
    items
        .regenerate
        .set_enabled(menu_state.is_generated)
        .map_err(|error| error.to_string())?;
    items
        .regenerate
        .set_text(if menu_state.is_archived {
            "Reload Archived Snapshot"
        } else {
            "Regenerate Page"
        })
        .map_err(|error| error.to_string())?;
    items
        .reimagine
        .set_enabled(menu_state.is_generated && !menu_state.is_archived)
        .map_err(|error| error.to_string())?;
    items
        .open_live_site
        .set_enabled(menu_state.has_live_site)
        .map_err(|error| error.to_string())?;
    items
        .horizontal_tabs
        .set_checked(menu_state.horizontal_tabs)
        .map_err(|error| error.to_string())?;
    items
        .vertical_tabs
        .set_checked(!menu_state.horizontal_tabs)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn emit_native_menu_command<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(command) = native_menu_command(id) {
        let _ = app.emit_to("main", NATIVE_MENU_EVENT, command);
    }
}

pub(crate) fn native_menu_command(id: &str) -> Option<&'static str> {
    match id {
        NEW_TAB => Some(NEW_TAB),
        CLOSE_TAB => Some(CLOSE_TAB),
        FOCUS_ADDRESS => Some(FOCUS_ADDRESS),
        RELOAD => Some(RELOAD),
        STOP => Some(STOP),
        BACK => Some(BACK),
        FORWARD => Some(FORWARD),
        HOME => Some(HOME),
        HISTORY => Some(HISTORY),
        NEXT_TAB => Some(NEXT_TAB),
        PREVIOUS_TAB => Some(PREVIOUS_TAB),
        REGENERATE => Some(REGENERATE),
        REIMAGINE => Some(REIMAGINE),
        OPEN_LIVE_SITE => Some(OPEN_LIVE_SITE),
        HORIZONTAL_TABS => Some(HORIZONTAL_TABS),
        VERTICAL_TABS => Some(VERTICAL_TABS),
        OPEN_SETTINGS => Some(OPEN_SETTINGS),
        OPEN_GENERATION_SETTINGS => Some(OPEN_GENERATION_SETTINGS),
        OPEN_MODELS => Some(OPEN_MODELS),
        OPEN_PROFILES => Some(OPEN_PROFILES),
        OPEN_GITHUB => Some(OPEN_GITHUB),
        REPORT_ISSUE => Some(REPORT_ISSUE),
        _ => None,
    }
}
