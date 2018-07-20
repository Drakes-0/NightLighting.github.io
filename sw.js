var SW_VERSION = '1.0.0'
var CACHE_KEY = 'SW_CACHE_' + SW_VERSION

var CACHE_RESOURCE = {
    shell: [],
    assets: [],
    update: []
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_KEY)
            .then(cache => {
                cache.addAll(CACHE_RESOURCE.assets)

                var cachePromise = cache.addAll(CACHE_RESOURCE.shell)
                var updatePromise = CACHE_RESOURCE.update.length
                    ? Promise.all(
                        CACHE_RESOURCE.update.map(resourcePath => {
                            var url = new URL(resourcePath, location.href)
                            url.searchParams.append('_cache_timestamp', Date.now().toString())

                            return fetch(new Request(url))
                                .then(response => {
                                    if (!response || response.status !== 200) {
                                        throw new Error([
                                            'Request get ',
                                            url.href,
                                            ' failed with status ',
                                            response.status
                                        ].join(''))
                                    }

                                    return cache.put(resourcePath, response)
                                })
                        })
                    )
                    : Promise.resolve()

                return Promise.all([cachePromise, updatePromise])
            })
    )
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheKeys => Promise.all(
            cacheKeys
                .filter(cacheKey => cacheKey !== CACHE_KEY)
                .map(cacheKey => caches.delete(cacheKey))
        ))
    )
})

self.addEventListener('fetch', event => {
    var request = event.request
    if (request.method !== 'GET') return fetch(request)

    event.respondWith(
        caches.match(request).then(response => {
            return response || fetch(request)
        })
    )
})