// The protected homepage content.
// This HTML only leaves the server after someone has logged in, so anything
// private belongs here, not in the GitHub files.
// `account.role` is "Normal" or "Special" if you later want to show different things.

export function homeHtml(account) {
  return `
    <section class="clock-wrap">
      <div class="clock" id="clock">--:--:--</div>
      <div class="date" id="date"></div>
    </section>
  `;
}
