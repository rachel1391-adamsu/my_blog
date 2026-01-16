# ---------------------------
# 第一阶段：构建环境 (Builder)
# ---------------------------
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制依赖定义文件
COPY package.json ./

# 安装依赖 (使用 npm ci 更稳，如果你没有 package-lock.json，就把这行改成 npm install)
RUN npm install

# 复制所有源代码
COPY . .

# 执行构建 (Astro 默认会生成到 /app/dist 目录)
RUN npm run build

# ---------------------------
# 第二阶段：运行环境 (Nginx)
# ---------------------------
FROM nginx:alpine

# 把第一阶段构建好的 dist 文件夹复制到 Nginx 的默认网站目录
COPY --from=builder /app/dist /usr/share/nginx/html

# (可选) 自定义 Nginx 配置，防止刷新页面 404
# 简单的静态博客通常不需要复杂配置，默认即可

# 暴露 80 端口
EXPOSE 80

# 启动 Nginx

CMD ["nginx", "-g", "daemon off;"]
