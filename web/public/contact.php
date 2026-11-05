<?php
$pageTitle = 'Contact Us — FOX PLAYER';
$activeNav = 'contact';
require_once __DIR__ . '/header.php';
?>

<main class="section">
  <div class="container" style="max-width: 680px;">
    <div class="panel-card">
      <div class="panel-header">
        <h1 class="panel-title">Contact Support & Inquiries</h1>
        <p class="panel-desc">Need assistance with your FOX PLAYER activation or reseller packs? Reach out to our technical team.</p>
      </div>

      <form onsubmit="handleContact(event)">
        <div class="form-group">
          <label class="form-label" for="contact-name">Full Name *</label>
          <input type="text" id="contact-name" class="form-input" placeholder="Your Name" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="contact-email">Email Address *</label>
          <input type="email" id="contact-email" class="form-input" placeholder="you@domain.com" required>
        </div>

        <div class="form-group">
          <label class="form-label" for="contact-subject">Subject</label>
          <select id="contact-subject" class="form-select">
            <option value="activation">Device Activation Help</option>
            <option value="reseller">Reseller Packs Inquiry</option>
            <option value="playlist">Playlist Configuration Question</option>
            <option value="other">General Feedback</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="contact-msg">Message *</label>
          <textarea id="contact-msg" class="form-textarea" rows="4" placeholder="How can we assist you?" required></textarea>
        </div>

        <button type="submit" id="btn-contact" class="btn btn-primary btn-block" style="padding: 14px;">Send Message</button>
      </form>
    </div>
  </div>
</main>

<script>
  function handleContact(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-contact');
    btn.disabled = true;
    btn.textContent = 'Transmitting...';
    setTimeout(() => {
      showToast('Thank you! Your message has been sent successfully. We will get back to you shortly.', 'success');
      e.target.reset();
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }, 600);
  }
</script>

<?php require_once __DIR__ . '/footer.php'; ?>
