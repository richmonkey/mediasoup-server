
npx pm2 start ecosystem.config.js  --only app
pm2 cluster-mode 看不到debug的日志


设置NODE_PATH到rtc-media-tool所在目录


cd server 
MEDIASOUP_FORCE_PREBUILT_WORKER_DOWNLOAD=1  yarn install
MEDIASOUP_WORKER_BIN=/tmp/mediasoup_worker yarn install


# watch mode
https://stackoverflow.com/questions/37979489/how-to-watch-and-reload-ts-node-when-typescript-files-change