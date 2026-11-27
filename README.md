# WineDog

| Address | What it shows |
|---|---|
| `winedog.site` | A blank black page (or your photo, once you add it) |
| `winedog.site/1` | Sign-in, then the homepage (a clock for now) |
| `winedog.site/dev` | Your dev panel for managing accounts |

## How it fits together

```
GitHub Pages (top folder)         Cloudflare Worker (worker/)
  /        blank image              /api/login   checks email + code
  /1       sign-in + page shell  →  /api/me      sends the protected homepage
  /dev     panel shell              /api/admin/* accounts, codes, sessions, email
                                    D1 database  accounts and remembered devices
```

GitHub only hosts the page shells, so it holds nothing secret. The accounts, the codes and
the homepage content all live in Cloudflare. Someone reading the GitHub files sees only an
empty login form, and the homepage content (`worker/src/home.js`) is sent only after a
correct email and code.

When someone signs in, their device keeps a random sign-in key. They stay signed in forever
on that device until you change their code, disable or delete the account, or sign that
device out from the panel.

---

## One-time setup

### 1. Set up Cloudflare (automatic)

Double-click **`Setup Cloudflare.bat`** in the `Winedog` folder. It will:

1. Install Node.js if it's missing (it asks first)
2. Install the Cloudflare tools
3. Open your browser to sign in to Cloudflare (click **Allow**)
4. Create the `winedog` database and its tables
5. Publish the Worker (the first time, Cloudflare may ask you to pick a `workers.dev` name)
6. Ask you to choose your `/dev` admin password, and optionally paste a Resend key for emails
7. Put the Worker's address into `assets/config.js`

It's safe to run again any time, for example to change your admin password, add the Resend key,
or publish changes to `worker/src/home.js`. It skips anything already done.

<details><summary>Doing it by hand instead</summary>

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 create winedog     # paste the database_id into wrangler.toml
npm run db:init
npm run deploy                     # paste the printed URL into assets/config.js
npx wrangler secret put ADMIN_PASSWORD
```
</details>

### 2. Publish to GitHub

1. In GitHub Desktop, click **Publish repository**, name it `Winedog`, and **uncheck "Keep this code private"**.
   GitHub Pages needs a public repo on a free plan. That's safe here because nothing secret is in the repo.
2. On github.com, open the repo and go to **Settings → Pages**.
   - Source: **Deploy from a branch**, Branch: **main**, Folder: **/ (root)**, then Save.
   - Custom domain: `winedog.site`, then Save. Tick **Enforce HTTPS** once it becomes available (it can take up to an hour).

### 3. Point WineDog.site at GitHub (Namecheap)

In Namecheap, go to **Domain List → winedog.site → Manage → Advanced DNS** and delete any existing
parking-page records. Then add:

| Type | Host | Value |
|---|---|---|
| A Record | `@` | `185.199.108.153` |
| A Record | `@` | `185.199.109.153` |
| A Record | `@` | `185.199.110.153` |
| A Record | `@` | `185.199.111.153` |
| CNAME Record | `www` | `SillyMonkeyFlip.github.io.` (your GitHub username) |

DNS changes can take from a few minutes to a few hours.

### 4. Turn on emailing codes (Resend, free)

Until this is done, the **Email code** button opens your own mail app with the message filled in.

1. Sign up at [resend.com](https://resend.com) and go to **Domains → Add domain → `winedog.site`**.
2. Resend shows some DNS records (TXT and MX). Add each one in Namecheap Advanced DNS exactly as shown,
   then click **Verify** in Resend.
3. In Resend, go to **API Keys → Create API key** and copy it.
4. Run **`Setup Cloudflare.bat`** again and paste the key when it asks.

Emails come from `noreply@winedog.site` and say: *Your code for Winedog.site is CODE*.
You can change the sender in `wrangler.toml` (`EMAIL_FROM`), then run `npm run deploy`.

---

## Everyday use

- **Add someone:** go to `winedog.site/dev`, sign in with your admin password, fill in their email,
  pick a role (Normal or Special), type a code or click **Random** (3 characters), and optionally tick
  "Email the code to them now".
- **Resend a code:** click **Email code** on their row.
- **Change a code:** click **Edit**. Changing it signs them out on every device.
- **See their devices:** click the number in the **Sessions** column. You can sign out one device or all of them.
- **Disable or delete:** disabling signs them out everywhere and blocks sign-in until you enable it again.

The admin sign-in lasts 12 hours on a device.

## Changing things

- **Landing page image:** save your photo as `image.jpg` (next to `index.html`), then commit and push.
- **Homepage content:** edit `worker/src/home.js`, then run **`Setup Cloudflare.bat`** again (or `npm run deploy` in the `worker` folder).
  Keep private content there, not in the website files, because everything in the repo is public on GitHub.
  `account.role` is passed in, ready for showing Special users different things later.
- **Page styling:** `assets/style.css`.

## Testing on your own computer

```powershell
# terminal 1
cd worker
echo ADMIN_PASSWORD=test > .dev.vars
npm run db:init:local
npm run dev

# terminal 2
npx serve -l 8080
```

Then open `http://localhost:8080/dev/` (password `test`) and `http://localhost:8080/1/`.

## Security notes

- **3-character codes are short.** There are about 32,000 possible random codes, so the Worker locks an email
  for 15 minutes after 5 wrong tries, and an internet address after 20. That makes guessing slow, but someone
  determined and patient could still get in eventually. Longer codes are much safer, and the panel accepts codes of any length.
- **Codes are stored readable** in the Cloudflare database so the panel can show and email them.
  Only your Worker, behind your admin password, can read them.
- **Your admin password** exists only as a Cloudflare secret. Pick a long one.
