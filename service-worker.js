const CACHE_NAME = 'alfajr-v7';

const CORE_FILES = [
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/theme.css',
  './css/responsive.css',
  './css/icons.css',
  './js/config.js',
  './js/customer.js',
  './js/database.js',
  './js/ui.js',
  './js/profile.js',
  './js/print.js',
  './js/theme.js',
  './js/main.js',
];

const OPTIONAL_FILES = [
  './assets/icon-192.png',
  './assets/icon-512.png',
];

// ========== نصب ==========
self.addEventListener('install', event => {
  console.log('🔧 [SW] شروع نصب...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      console.log('📦 [SW] در حال cache کردن فایل‌ها...');
      
      let successCount = 0;
      let failCount = 0;

      // CORE FILES
      for (const url of CORE_FILES) {
        try {
          await cache.add(url);
          console.log(`✅ [SW] ${url}`);
          successCount++;
        } catch (e) {
          console.error(`❌ [SW] خطا در cache: ${url}`, e.message);
          failCount++;
        }
      }

      // OPTIONAL FILES
      for (const url of OPTIONAL_FILES) {
        try {
          await cache.add(url);
          console.log(`✅ [SW] ${url} (اختیاری)`);
          successCount++;
        } catch (e) {
          console.warn(`⚠️ [SW] فایل اختیاری نبود: ${url}`);
        }
      }

      console.log(`📊 [SW] نتیجه: ${successCount} موفق, ${failCount} خطا`);
      console.log('✅ [SW] نصب کامل شد');
      return self.skipWaiting();
    }).catch(err => {
      console.error('❌ [SW] نصب شکست خورد:', err);
      throw err;
    })
  );
});

// ========== فعال‌سازی ==========
self.addEventListener('activate', event => {
  console.log('⚡ [SW] فعال‌سازی...');
  
  event.waitUntil(
    caches.keys().then(names => {
      const oldCaches = names.filter(n => n !== CACHE_NAME);
      console.log(`🗑️ [SW] پاک کردن ${oldCaches.length} cache قدیمی`);
      
      return Promise.all(
        oldCaches.map(name => {
          console.log(`🗑️ [SW] حذف: ${name}`);
          return caches.delete(name);
        })
      );
    }).then(() => {
      console.log('✅ [SW] فعال شد - CACHE:', CACHE_NAME);
      return self.clients.claim();
    })
  );
});

// ========== fetch ==========
// استراتژی: برای فایل‌های اصلی اپ (HTML/CSS/JS) اول شبکه رو امتحان کن (تا همیشه
// جدیدترین نسخه لود بشه، بدون نیاز به تغییر دستی شماره‌ی cache)، و اگه شبکه در
// دسترس نبود (یا کند بود) بلافاصله از cache استفاده کن — یعنی همچنان صددرصد آفلاین کار می‌کنه.
// برای بقیه‌ی فایل‌ها (مثل آیکون‌ها) همون cache-first سریع‌تر باقی می‌مونه.
function isAppShellFile(url) {
  return CORE_FILES.some(f => url.endsWith(f.replace('./', '/')) || url.endsWith(f.replace('./', '')));
}

self.addEventListener('fetch', event => {
  // blob و print رو رد کن
  if (event.request.url.startsWith('blob:') ||
      event.request.url.includes('print')) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  const isShell = isNavigation || isAppShellFile(event.request.url);

  if (isShell) {
    // network-first با timeout کوتاه، تا آفلاین بودن باعث تأخیر زیاد نشه
    event.respondWith(
      Promise.race([
        fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
      ]).catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        // فقط برای درخواست ناوبری (خود صفحه) به index.html برگرد؛
        // برای فایل‌های js/css اگه توی cache نبود، نباید بجاش HTML برگردونیم
        // چون مرورگر سعی می‌کنه اون HTML رو به‌عنوان JS/CSS اجرا کنه و کل اپ خراب می‌شه
        if (isNavigation) return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline and not cached' });
      }))
    );
    return;
  }

  // cache-first برای بقیه‌ی فایل‌ها (آیکون‌ها و غیره)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(err => {
        console.warn('[SW] آفلاین:', event.request.url);
      });
    })
  );
});

// ========== message ==========
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('⏭️ [SW] skipWaiting درخواست شد');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('🚀 [SW] service-worker.js لود شد - نسخه:', CACHE_NAME);
