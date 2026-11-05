<?php
$pageTitle = 'Privacy Policy — FOX PLAYER';
$activeNav = '';
require_once __DIR__ . '/header.php';
?>

<main class="section">
  <div class="container" style="max-width: 840px;">
    <div class="panel-card">
      <div class="panel-header">
        <h1 class="panel-title">Privacy Policy</h1>
        <p class="panel-desc">Last updated: October 2026</p>
      </div>

      <div style="font-size: 15px; color: var(--text-secondary); line-height: 1.8; display: flex; flex-direction: column; gap: 20px;">
        <section>
          <h2 style="color: #FFFFFF; font-size: 18px; margin-bottom: 8px;">1. Information We Collect</h2>
          <p>We collect device identifiers (Device ID or anonymized MAC address) solely for the purpose of managing software licensing, trial activation, and syncing playlist configurations requested by the user.</p>
        </section>

        <section>
          <h2 style="color: #FFFFFF; font-size: 18px; margin-bottom: 8px;">2. Credentials Encryption</h2>
          <p>Any Xtream Codes passwords and server credentials configured by the user are stored encrypted using high-grade AES-256 cipher encryption and are never sold or shared with any third party.</p>
        </section>

        <section>
          <h2 style="color: #FFFFFF; font-size: 18px; margin-bottom: 8px;">3. No Media Logging</h2>
          <p>FOX PLAYER does not monitor, log, or record the audiovisual content viewed by end users.</p>
        </section>
      </div>
    </div>
  </div>
</main>

<?php require_once __DIR__ . '/footer.php'; ?>
