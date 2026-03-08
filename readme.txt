taskkill /F /IM node.exe /T

cmd /c "set PATH=C:\Program Files\nodejs;%PATH% && npm run dev"
cmd /c "set PATH=C:\Program Files\nodejs;%PATH% && node server.js"

✅ Backend → http://localhost:3001 (with FFmpeg detected)
✅ Frontend → http://localhost:5173 (back on the default port)



http://localhost:3001/api/render/download/3b848e2a-081b-47f8-9f2d-18b57a534ab9