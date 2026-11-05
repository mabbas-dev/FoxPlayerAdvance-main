<?php
// FOX PLAYER Shared Header
if (!isset($pageTitle)) $pageTitle = 'FOX PLAYER — Ultimate IPTV & Media Player';
if (!isset($activeNav)) $activeNav = 'home';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($pageTitle); ?></title>
  <meta name="description" content="FOX PLAYER is a high-performance IPTV & multimedia player supporting Xtream Codes API, M3U playlists, multi-device management, and fast channel zapping.">
  <link rel="icon" type="image/png" href="/assets/inside-app-logo.png?v=2.2">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/style.css?v=2.2">
</head>
<body>
  <header class="site-header">
    <div class="container">
      <div class="nav-wrap">
        <a href="/" class="brand-logo" title="FOX PLAYER">
          <img src="/assets/inside-app-logo.png?v=2.2" alt="FOX PLAYER">
        </a>

        <button class="mobile-toggle" id="mobile-toggle" aria-label="Toggle navigation">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>

        <nav class="nav-links" id="nav-links">
          <a href="/" class="nav-link <?php echo ($activeNav === 'home') ? 'active' : ''; ?>">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            Home
          </a>
          <a href="/upload" class="nav-link <?php echo ($activeNav === 'upload') ? 'active' : ''; ?>">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Upload List
          </a>
          <a href="/activation" class="nav-link <?php echo ($activeNav === 'activation') ? 'active' : ''; ?>">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
            Activation
          </a>
          <a href="/contact-us" class="nav-link <?php echo ($activeNav === 'contact') ? 'active' : ''; ?>">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            Contact
          </a>
          <a href="/admin" class="nav-link admin-link <?php echo ($activeNav === 'admin') ? 'active' : ''; ?>">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Admin Panel
          </a>
        </nav>
      </div>
    </div>
  </header>
  <div id="toast-container"></div>
