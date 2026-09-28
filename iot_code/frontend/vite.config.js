import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Địa chỉ + ABI contract nằm trong src/deployments (bản copy do contracts/scripts/deploy.js ghi),
// nên không cần cho phép đọc file ngoài thư mục frontend.
export default defineConfig({
  plugins: [react()],
})
