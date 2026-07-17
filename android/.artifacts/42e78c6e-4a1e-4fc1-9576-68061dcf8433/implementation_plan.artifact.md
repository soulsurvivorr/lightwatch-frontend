# Implementation Plan - Fix App Icon Not Showing

The user is trying to update their app icon by placing it in `assets/icon.png` in their Capacitor project, but the Android app is still showing the old or default logo.

## User Review Required

> [!IMPORTANT]
> To properly support modern Android devices, you should ideally have two files for your icon: a **foreground** (the logo itself) and a **background** (usually a solid color or simple pattern). If you only provide one, the tool will try to generate an adaptive icon, but it may not look as expected.

## Proposed Changes

### 1. Resource Generation
The primary reason the icon isn't showing is that Android does not read from the `assets/` folder for the launcher icon. It reads from the `android/app/src/main/res/mipmap-*` folders. In a Capacitor project, these should be generated using the `@capacitor/assets` tool.

#### [ACTION] Run Asset Generation
We will instruct the user to run:
```bash
npx capacitor-assets generate --android
```
This command takes the images in your `assets/` folder and generates all the necessary density-specific icons in the Android project.

### 2. Adaptive Icon Optimization
For best results on Android 8.0+, we should ensure the adaptive icon resources are correctly defined. Currently, there are leftover default vector icons that might be causing confusion.

#### [MODIFY] [ic_launcher.xml](file:///C:/Users/SARKODIE/Desktop/LightWatch/frontend/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml)
Ensure it points to the generated `mipmap` resources. (Currently it does, but we will verify after generation).

#### [DELETE] [ic_launcher_foreground.xml](file:///C:/Users/SARKODIE/Desktop/LightWatch/frontend/android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml)
#### [DELETE] [ic_launcher_background.xml](file:///C:/Users/SARKODIE/Desktop/LightWatch/frontend/android/app/src/main/res/drawable/ic_launcher_background.xml)
These are default Android Studio icons that can sometimes override the intended ones if not handled carefully.

## Verification Plan

### Manual Verification
1. Run the asset generation command.
2. Verify that the files in `android/app/src/main/res/mipmap-*` have been updated.
3. **CRITICAL**: Uninstall the app from the device/emulator and reinstall it. Android caches launcher icons heavily, and updates often don't show until a clean install.
4. Check the app drawer and home screen for the new icon.
