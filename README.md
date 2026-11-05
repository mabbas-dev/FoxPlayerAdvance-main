# FoxPlayerDevelopment

[![React Native](https://img.shields.io/badge/React%20Native-0.86.3-blue.svg)](https://reactnative.dev/)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-57-black.svg)](https://expo.dev/)
[![Engines](https://img.shields.io/badge/Dual%20Playback-ExoPlayer%20%7C%20AVPlayer%20%7C%20MobileVLCKit-orange.svg)]()
[![Backend](https://img.shields.io/badge/Backend-PHP%208.2%20REST%20API-777BB4.svg)]()
[![Database](https://img.shields.io/badge/Database-MariaDB%20%2F%20MySQL-003545.svg)]()

> **FoxPlayer** is an enterprise-grade IPTV and multimedia streaming ecosystem designed for multi-platform environments (Android Mobile, Android TV, Fire TV, iOS / iPadOS, Apple TV, macOS, Windows, and Web).

---

## Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │          FOX PLAYER APP                │
                      │  (Expo SDK 57 / React Native 0.86)     │
                      │   - Native Engine (ExoPlayer/AVPlayer) │
                      │   - VLC Engine (MobileVLCKit / libVLC) │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │          api.foxplayer.app             │
                      │      (PHP 8.2+ High-Throughput API)    │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │         u139837297_fox_db              │
                      │       (MariaDB / MySQL Server)         │
                      └──────────────────▲─────────────────────┘
                                         │
                                         │
                      ┌──────────────────┴─────────────────────┐
                      │           foxplayer.app                │
                      │  (Web Pairing, Activation & Admin)     │
                      └────────────────────────────────────────┘
```

---

## Key Features & Capabilities

### 1. Dual Playback Engine Architecture
- **Primary Native Engine**: Hardware-accelerated playback utilizing **Google ExoPlayer (Android)** via `expo-video` / Media3 and **Apple AVPlayer (iOS)**. Optimized for minimal latency and maximum battery efficiency.
- **Integrated VLC Engine**: Full-fidelity fallback engine utilizing **MobileVLCKit (iOS)** and **libVLC (Android)** via `rn-vlc-plyr`. Plays streams with esoteric audio/video codecs, non-standard transport streams (TS), MPEG-2, and legacy broadcasts that native players cannot decode.
- **Intelligent Fallback Coordinator (`useDualPlaybackEngine.js`)**: Automatically detects player decoding errors, demuxing failures, and transport errors to trigger seamless fallback to VLC without interrupting the user experience.
- **Loop Prevention Guard**: Strict retry tracking ensures the coordinator never enters an infinite fallback loop on unrecoverable stream failures.
- **Audio & State Preservation**: Audio session state, volume level, mute status, and aspect ratio (`contain`, `cover`, `fill`) are automatically preserved during engine transitions.
- **Centralized Engine Settings (`playerSettings.js`)**: Allows users and developers to select between `AUTO` (smart fallback), `NATIVE` (ExoPlayer/AVPlayer only), and `VLC` (VLC engine priority), persisted via `AsyncStorage`.

### 2. Comprehensive IPTV Protocol Support
- **Xtream Codes API**: Full support for Live Channels, Movies (VOD), and TV Series (with structured season and episode hierarchies).
- **M3U / M3U8 Playlists**: Robust parsing with fast category indexing, group titles, and channel metadata.
- **Direct Number Zapping**: On-screen numeric channel dialing for instant switching on smart TVs and remotes.
- **Live EPG**: Electronic Program Guide timeline display with current and upcoming program metadata.
- **Parental Controls**: Secure PIN-protected category locking.
- **Favorites & Search**: Instant cross-category search and quick-access favorites drawer.

### 3. Cloud Device Pairing & License Management
- **Hardware MAC & Device ID Binding**: Devices register a unique persistent hardware fingerprint.
- **Web Pairing Portal (`server-web`)**: Users can pair and manage playlists from any web browser by entering their MAC address or Device ID without typing complex URLs on TV remotes.
- **Flexible Subscription Plans**: Authoritative server-side licensing supporting Trial periods, 1-Year plans, and Lifetime (Forever) activations.
- **ID Lock Security**: Device locking mechanisms protect registered playlists from unauthorized external changes.
- **Admin Control Panel**: Real-time KPI dashboards, trial duration management, device directory, playlist sync audits, and subscription extensions.

---

## Repository Structure

```
FoxPlayerDevelopment/
├── assets/                    # Icons, adaptive icons, splash screens, logos
├── plugins/
│   └── withVlcKit.js          # Custom Expo Config Plugin for iOS VLCKit & Android libVLC
├── scripts/                   # Automated deployment & database management scripts
│   ├── deploy_api.py          # SFTP deployment script for api.foxplayer.app
│   ├── deploy_web.py          # SFTP deployment script for foxplayer.app
│   ├── check_devices.py       # Remote diagnostics for device registrations
│   └── check_subs.py          # Remote diagnostics for subscriptions
├── server-api/                # Backend REST API (PHP 8.2+)
│   ├── config.php             # Database credentials and API encryption settings
│   ├── index.php              # REST router & endpoint controllers
│   └── .htaccess              # Clean URL rewrites & security headers
├── server-web/                # Web Activation, Pairing Portal & Admin Dashboard
│   ├── index.html             # Customer landing page & pricing showcase
│   ├── upload.html            # Web playlist upload & device pairing
│   ├── activation.html        # Subscription check & online activation
│   ├── admin.html             # Master administrator control panel
│   └── api/                   # Web portal internal API handlers
├── src/                       # Main React Native / Expo Application
│   ├── app/                   # Expo Router file-based screens and navigators
│   ├── components/            # Reusable UI components & modals
│   │   ├── EmbeddedVideoPlayer.js   # Main unified video player component
│   │   ├── PlaybackEngineModal.js   # Engine selector and diagnostics dialog
│   │   └── ...
│   ├── playback/              # Dual Playback Engine implementation
│   │   ├── engines/           # Native & VLC playback engine adapters
│   │   ├── components/        # Unified video surface view
│   │   ├── playerSettings.js  # Persistent playback configuration
│   │   └── useDualPlaybackEngine.js # Fallback and switching coordinator
│   ├── screens/               # Core screens (Live, VOD, Series, Player, Settings)
│   ├── state/                 # State management & persistence
│   └── utils/                 # Cryptography, networking, error mappers
├── tests/                     # Automated unit and integration test suites
│   ├── testDualPlaybackArchitecture.js
│   └── testPlayerSettingsAndSwitching.js
├── app.json                   # Expo configuration & native build plugins
├── package.json               # Application dependencies and npm scripts
└── README.md                  # Team developer documentation
```

---

## Team Setup & Getting Started

### Prerequisites
- **Node.js**: v20.x or higher
- **npm** or **bun**
- **Git** configured on your local workstation
- **Android Studio** (for Android SDK, emulator, and local APK builds)
- **Xcode** (macOS only, for iOS simulator and builds)
- **EAS CLI**: `npm install -g eas-cli` (for cloud builds)

---

### Git & Team Collaboration Setup

#### 1. Cloning the Repository

**Option A: Via SSH (Recommended for Team Members)**
```bash
git clone git@github.com:mabbas-dev/FoxPlayerDevelopment.git
cd FoxPlayerDevelopment
```

**Option B: Via HTTPS**
```bash
git clone https://github.com/mabbas-dev/FoxPlayerDevelopment.git
cd FoxPlayerDevelopment
```

---

#### 2. Configuring SSH Access for Team Members

If you or your team members encounter SSH connection timeouts on standard port 22 (common on restricted corporate networks, educational institutions, or certain ISPs), configure SSH over GitHub's HTTPS port (443):

1. **Generate an SSH key pair** (if not already created):
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. **Add SSH config** to `~/.ssh/config` (Windows: `C:\Users\<User>\.ssh\config`, macOS/Linux: `~/.ssh/config`):
   ```ssh-config
   Host github.com
       Hostname ssh.github.com
       Port 443
       User git
       IdentityFile ~/.ssh/id_ed25519
       StrictHostKeyChecking accept-new
   ```

3. **Add your public key to GitHub**:
   - Copy the contents of your public key (`~/.ssh/id_ed25519.pub`).
   - Go to [GitHub Settings -> SSH and GPG keys](https://github.com/settings/keys).
   - Click **New SSH key**, paste your key, and save.

4. **Verify SSH connection**:
   ```bash
   ssh -T git@github.com
   # Expected output: Hi <username>! You've successfully authenticated...
   ```

5. **Set the Git Remote to SSH**:
   ```bash
   git remote set-url origin git@github.com:mabbas-dev/FoxPlayerDevelopment.git
   ```

---

### Installation & Running

1. **Install Dependencies**:
   ```bash
   npx expo install
   ```

2. **Start the Expo Development Server**:
   ```bash
   npx expo start
   ```

3. **Running on Native Devices / Emulators**:
   > **Note on Native Code**: Because FoxPlayer uses native VLCKit (`rn-vlc-plyr`) and `expo-video`, standard Expo Go does not contain all custom native modules. You must use **Development Builds**:

   ```bash
   # Generate native projects and run on Android
   npx expo run:android

   # Generate native projects and run on iOS (macOS required)
   npx expo run:ios
   ```

---

### Running the Test Suites

FoxPlayer includes test suites for the dual playback engine, failover coordinator, and settings persistence:

```bash
# Run architecture & coordinator tests
node tests/testDualPlaybackArchitecture.js

# Run player settings & switching test suite
node tests/testPlayerSettingsAndSwitching.js
```

---

### EAS Cloud Builds

To generate release APKs or iOS builds in the cloud with EAS:

```bash
# Login to EAS
eas login

# Build Android APK / AAB
eas build --platform android --profile development
eas build --platform android --profile preview

# Build iOS IPA
eas build --platform ios --profile development
```

---

### Server Deployment

The web portal (`server-web/`) and REST API (`server-api/`) can be deployed to production using the Python SFTP scripts:

```bash
# Deploy REST API to api.foxplayer.app
python scripts/deploy_api.py

# Deploy Web Portal to foxplayer.app
python scripts/deploy_web.py
```

---

## Contribution & Branching Strategy

1. **Main Branch (`main`)**: Production-ready code. Direct commits should be reviewed and tested.
2. **Feature Branches**: Create branches named `feat/<feature-name>` for new functionality.
3. **Bugfix Branches**: Create branches named `fix/<bug-description>` for fixes.
4. **Pre-commit Checklist**:
   - Run `npx expo lint` to verify code formatting.
   - Run `node tests/testDualPlaybackArchitecture.js` and `node tests/testPlayerSettingsAndSwitching.js`.
   - Ensure native build plugins (`plugins/withVlcKit.js`) remain compatible.

---

## Confidentiality & License

This codebase is proprietary and confidential. Access is restricted to authorized team members and collaborators of **FoxPlayer**. Unauthorized reproduction, redistribution, or modification is strictly prohibited.
