# Local Amazon Growth Console Prototype

This folder contains the local static prototype built in `选品工具`.

## Run

```powershell
npm install
npm start
```

Then open:

```text
http://127.0.0.1:4173/
```

## Notes

- Jungle Scout realtime ASIN lookup is proxied through `scripts/local_api_server.js`.
- Do not commit real API keys. The local server reads credentials from environment variables or `Desktop/api.txt`.
- Raw Excel files, logs, local database files, and `node_modules` are intentionally excluded.
