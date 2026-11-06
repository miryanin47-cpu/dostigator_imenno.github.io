// Версия кеша - меняйте при каждом обновлении приложения
const CACHE_NAME = 'my-app-v1';

// Список файлов для кеширования
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Кеш открыт');
        return cache.addAll(urlsToCache);
      })
  );
});

// Активация - удаление старых кешей
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Удаляю старый кеш:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Перехват сетевых запросов
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Если файл есть в кеше - возвращаем его
        if (response) {
          return response;
        }
        // Иначе загружаем из сети
        return fetch(event.request);
      }
    )
  );
});