  <!-- FOX PLAYER Modern Footer -->
  <footer class="site-footer">
    <div class="container">
      <div class="footer-main-grid">
        <!-- Col 1: Brand -->
        <div class="footer-col footer-col-brand">
          <a href="/" class="brand-logo" title="FOX PLAYER" style="margin-bottom: 16px; display: inline-block;">
            <img src="/assets/inside-app-logo.png?v=2.2" alt="FOX PLAYER" style="height: 52px; width: auto; object-fit: contain;">
          </a>
          <p class="footer-text">
            FOX PLAYER is a next-generation IPTV and multimedia playback suite engineered for Android TV, Smart TVs, and mobile screens. Enjoy seamless zapping and 4K playback.
          </p>
          <div class="footer-badges">
            <span class="status-pill status-pill-online">
              <span class="pulse-dot"></span> All Systems Operational
            </span>
            <span class="status-pill status-pill-secure">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              256-Bit SSL Encrypted
            </span>
          </div>
        </div>

        <!-- Col 2: Player Features -->
        <div class="footer-col">
          <h4 class="footer-col-title">Player Features</h4>
          <ul class="footer-links-list">
            <li><a href="/upload">Upload M3U Playlist</a></li>
            <li><a href="/upload">Xtream Codes API</a></li>
            <li><a href="/upload">Multi-List Management</a></li>
            <li><a href="/#features">Fast Channel Zapping</a></li>
            <li><a href="/#features">Parental Controls & PIN</a></li>
            <li><a href="/#features">Hardware Acceleration</a></li>
          </ul>
        </div>

        <!-- Col 3: Portal & Services -->
        <div class="footer-col">
          <h4 class="footer-col-title">Activation & Support</h4>
          <ul class="footer-links-list">
            <li><a href="/activation">Device Activation</a></li>
            <li><a href="/activation">Check License Status</a></li>
            <li><a href="/upload">Wipe Device Lists</a></li>
            <li><a href="/contact-us">Contact Support</a></li>
            <li><a href="/admin">Administrator Portal</a></li>
          </ul>
        </div>

        <!-- Col 4: Supported Devices -->
        <div class="footer-col">
          <h4 class="footer-col-title">Supported Devices</h4>
          <ul class="footer-links-list footer-devices-list">
            <li><span>Android TV / Google TV</span></li>
            <li><span>Samsung Smart TV (Tizen)</span></li>
            <li><span>LG Smart TV (webOS)</span></li>
            <li><span>Amazon Fire TV Stick</span></li>
            <li><span>Apple TV & iOS</span></li>
            <li><span>Windows & Mac</span></li>
          </ul>
        </div>
      </div>

      <!-- Legal Disclaimer -->
      <div class="footer-disclaimer">
        <strong>Important Legal Disclaimer:</strong> FOX PLAYER is strictly an advanced media player software. FOX PLAYER does not provide, host, sell, bundle, or distribute any media content, IPTV channels, or streams. Users must provide their own legitimate content credentials.
      </div>

      <!-- Footer Bottom -->
      <div class="footer-bottom">
        <div class="footer-copyright">
          &copy; <?php echo date('Y'); ?> FOX PLAYER. All rights reserved. Ultra-low latency IPTV streaming engine.
        </div>
        <div class="footer-bottom-links">
          <a href="/terms">Terms of Online Sale</a>
          <span class="sep">&bull;</span>
          <a href="/privacy">Privacy Policy</a>
          <span class="sep">&bull;</span>
          <a href="/contact-us">Contact Us</a>
          <span class="sep">&bull;</span>
          <a href="/admin">Admin Login</a>
        </div>
      </div>
    </div>
  </footer>

  <script>
    // Shared Frontend Client for api.foxplayer.app
    window.API_BASE = 'https://api.foxplayer.app';

    // Toast notifications
    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `<span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    // Mobile menu toggle
    const mobileBtn = document.getElementById('mobile-toggle');
    const navLinks = document.getElementById('nav-links');
    if (mobileBtn && navLinks) {
      mobileBtn.addEventListener('click', () => {
        navLinks.classList.toggle('mobile-open');
      });
    }

    // MAC Address automatic formatting helper
    function formatMacInput(input) {
      input.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (val.length > 12) val = val.substring(0, 12);
        let formatted = '';
        for (let i = 0; i < val.length; i++) {
          if (i > 0 && i % 2 === 0) formatted += ':';
          formatted += val[i];
        }
        e.target.value = formatted;
      });
    }
  </script>
</body>
</html>
