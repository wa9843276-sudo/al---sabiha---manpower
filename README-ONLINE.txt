AL SABIHA MANPOWER MANAGEMENT SYSTEM — ONLINE FREE DEPLOYMENT

Recommended platform: Railway Free.
Current Railway Free plan is $0/month and includes $1/month of free resource credit; a 0.5 GB volume is available for persistent storage. See official pricing/docs.
This project uses SQLite and expects the Railway Volume to be mounted at /data.

Default login:
Username: admin
Password: admin123
CHANGE THE PASSWORD immediately in Settings.

Deploy:
1. Upload this project to GitHub.
2. Railway -> New Project -> Deploy from GitHub Repo.
3. Set Start Command: npm start (usually automatic).
4. Add a Volume and mount path: /data
5. Add environment variable:
   DATA_DIR=/data
   SESSION_SECRET=<long-random-secret>
   NODE_ENV=production
6. Deploy.
7. Railway gives an HTTPS public URL.
8. Open the URL from phone/PC.

Important:
- Do NOT use the free service without a volume if you need persistent attendance data.
- The service may sleep/scale according to the host's free-tier rules.
- This project is designed for testing/personal use on free infrastructure.
- Existing offline SQLite data is not automatically imported. Export/backup your old data before migration.
