/* ニュース表示用の共通スクリプト（公開ページ・管理画面のプレビューで共用）
 * データは news/news.json。本文は「簡易記法」のテキストで、ここでHTMLに変換する。
 *   空行        … 段落の区切り
 *   ## 見出し   … 太字の小見出し
 *   - 項目      … 箇条書き
 *   **太字** / *斜体* / [表示名](URL) / URLだけでも自動リンク
 * 画像パスは常にサイト直下からの相対パス（例: news/img/20261004.jpg）。
 */
(function (global) {
    'use strict';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // http(s) と サイト内の相対パスだけを許可（javascript: などを防ぐ）
    function safeUrl(u) {
        u = String(u).trim();
        return /^(https?:\/\/|mailto:|[\w\-./#?=&%]+$)/i.test(u) && !/^\s*(javascript|data):/i.test(u) ? u : '#';
    }

    function inline(text, prefix) {
        var s = esc(text);
        var links = [];
        // [表示名](URL)
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
            url = url.replace(/&amp;/g, '&');
            links.push(linkHtml(label, url, prefix));
            return '\u0000' + (links.length - 1) + '\u0000';
        });
        // URLだけ書かれた場合
        s = s.replace(/(^|[^"\u0000])(https?:\/\/[A-Za-z0-9\-._~:\/?#@!$&;=%+]+)/g, function (_, pre, url) {
            var u = url.replace(/&amp;/g, '&');
            links.push(linkHtml(url, u, prefix));
            return pre + '\u0000' + (links.length - 1) + '\u0000';
        });
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
        return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return links[+i]; });
    }

    function linkHtml(label, url, prefix) {
        var external = /^https?:\/\//i.test(url);
        var href = safeUrl(url);
        if (!external && href !== '#' && !/^(mailto:|#)/.test(href)) href = (prefix || '') + href;
        return '<a href="' + esc(href) + '" class="custom-link"' +
            (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + label + '</a>';
    }

    // 本文 → HTML。prefix は内部リンクの前に付けるパス（news/ 内のページなら "../"）
    function renderBody(text, prefix) {
        var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
        var out = [];
        blocks.forEach(function (block) {
            var lines = block.split('\n').filter(function (l) { return l.trim() !== ''; });
            if (!lines.length) return;
            var i = 0;
            var para = [];
            function flushPara() {
                if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; }
            }
            while (i < lines.length) {
                var line = lines[i];
                if (/^##\s+/.test(line)) {
                    flushPara();
                    out.push('<p class="mt-4 mb-1 fw-bold text-dark">' + inline(line.replace(/^##\s+/, ''), prefix) + '</p>');
                    i++;
                } else if (/^[-・]\s+/.test(line)) {
                    flushPara();
                    var items = [];
                    while (i < lines.length && /^[-・]\s+/.test(lines[i])) {
                        items.push('<li>' + inline(lines[i].replace(/^[-・]\s+/, ''), prefix) + '</li>');
                        i++;
                    }
                    out.push('<ul class="mb-4">' + items.join('') + '</ul>');
                } else {
                    para.push(inline(line, prefix));
                    i++;
                }
            }
            flushPara();
        });
        return out.join('\n');
    }

    function dotDate(iso) { return String(iso || '').replace(/-/g, '.'); }

    function sortItems(items) {
        return items.slice().sort(function (a, b) {
            return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1);
        });
    }

    function rowHtml(item, last, articleHref) {
        return '<a href="' + esc(articleHref) + '" class="news-item d-flex align-items-center justify-content-between py-3 px-2' + (last ? '' : ' border-bottom') + '">' +
            '<div class="d-flex align-items-start align-items-md-center flex-wrap flex-md-nowrap gap-2 gap-md-4 w-100 overflow-hidden">' +
            '<div class="d-flex align-items-center gap-2" style="min-width: 175px;">' +
            '<time class="text-muted fw-bold" style="min-width: 90px;">' + esc(dotDate(item.date)) + '</time>' +
            (item.category ? '<span class="badge badge-custom-sub px-2 py-1 small fw-normal" style="min-width: 68px; text-align: center;">' + esc(item.category) + '</span>' : '') +
            '</div>' +
            '<span class="fw-bold news-title text-wrap text-md-truncate">' + esc(item.title) + '</span>' +
            '</div><div class="news-arrow text-custom-blue fw-bold ms-2 align-self-center">→</div></a>';
    }

    function load(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }

    // 一覧を target に描画（limit 指定でトップの最新N件）。公開(draft でない)記事のみ
    function renderList(target, url, limit) {
        var el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        load(url).then(function (data) {
            var items = sortItems((data.items || []).filter(function (n) { return !n.draft; }));
            if (limit) items = items.slice(0, limit);
            if (!items.length) { el.innerHTML = '<p class="text-muted text-center my-4">お知らせはまだありません。</p>'; return; }
            el.innerHTML = items.map(function (n, i) {
                return rowHtml(n, i === items.length - 1, 'news/article.html?id=' + encodeURIComponent(n.id));
            }).join('');
        }).catch(function () {
            el.innerHTML = '<p class="text-muted text-center my-4">お知らせを読み込めませんでした。</p>';
        });
    }

    // 記事ページ（news/article.html）用
    function renderArticle(target, url) {
        var el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) return;
        var id = new URLSearchParams(location.search).get('id');
        load(url).then(function (data) {
            var n = (data.items || []).filter(function (x) { return x.id === id; })[0];
            if (!n) { el.innerHTML = '<p class="text-center my-5">記事が見つかりませんでした。</p>'; return; }
            document.title = n.title + ' | BIOMOD Team Science Tokyo';
            el.innerHTML =
                '<div class="d-flex align-items-center gap-3 mb-3">' +
                '<time datetime="' + esc(n.date) + '" class="text-muted fw-bold">' + esc(dotDate(n.date)) + '</time>' +
                (n.category ? '<span class="badge badge-custom-sub px-2 py-1 small fw-normal">' + esc(n.category) + '</span>' : '') +
                '</div>' +
                '<h1 class="h3 fw-bold text-custom-blue mb-4 pb-3 border-bottom" style="line-height: 1.5;">' + esc(n.title) + '</h1>' +
                (n.image ? '<div class="mb-4 text-center"><img src="../' + esc(n.image) + '" alt="' + esc(n.title) + '" class="img-fluid rounded-3 border shadow-sm" style="max-height: 400px; width: 100%; object-fit: cover;"></div>' : '') +
                '<div class="news-content text-secondary" style="line-height: 1.9;">' + renderBody(n.body, '../') + '</div>' +
                '<div class="border-top mt-5 pt-4 text-center"><a href="../news.html" class="text-decoration-none text-custom-blue fw-bold">← ニュース一覧に戻る</a></div>';
        }).catch(function () {
            el.innerHTML = '<p class="text-center my-5">記事を読み込めませんでした。</p>';
        });
    }

    global.NewsRender = { esc: esc, renderBody: renderBody, renderList: renderList, renderArticle: renderArticle, sortItems: sortItems, dotDate: dotDate };
})(window);
