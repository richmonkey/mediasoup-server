module.exports = {
  apps : [
    {
      name   : "app",
      script : "./src/server.js",
      instances : 1,
      exec_mode : "fork",
      env: {
        DEBUG_COLOR: 0,
        DEBUG: "*mediasoup* *Room* *InterphoneRoom* *INFO* *WARN* *ERROR*",
        NODE_PATH: "/data/node_libraries"
      }
    },
    {
      name   : "app-dev",
      script : "./src/server.js",
      instances : 1,
      exec_mode : "fork",
      watch : ["src"],
      ignore_watch : ["node_modules"],
    },
  ],
}
