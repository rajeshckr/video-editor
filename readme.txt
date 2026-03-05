taskkill /F /IM node.exe /T

cmd /c "set PATH=C:\Program Files\nodejs;%PATH% && npm run dev"
cmd /c "set PATH=C:\Program Files\nodejs;%PATH% && node server.js"

✅ Backend → http://localhost:3001 (with FFmpeg detected)
✅ Frontend → http://localhost:5173 (back on the default port)