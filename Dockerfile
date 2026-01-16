# ---------------------------
# 第一阶段：构建环境 (Builder)
# ---------------------------
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制依赖定义文件
COPY package.json ./

# 🔥【新增】全局安装 pnpm，因为你的代码里用到了它
RUN npm install -g pnpm

# 🔥【修改】改用 pnpm 来安装依赖 (这样更稳)
RUN pnpm install

# 复制所有源代码
COPY . .

# 执行构建
RUN npm run build

# ---------------------------
# 第二阶段：运行环境 (Nginx) - 下面这些不用变
# ---------------------------
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
