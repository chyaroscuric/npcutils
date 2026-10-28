// pm2 start ecosystem.config.cjs  ->  bot radi u pozadini i sam se restarta ako padne
module.exports = {
  apps: [
    {
      name: 'jaankeza-utils',
      script: 'src/index.js',
      autorestart: true,
      restart_delay: 5000,
      max_memory_restart: '300M',
    },
  ],
};
