/* ニュース管理画面
 * - 認証: 合言葉で admin-config.json（暗号化済みGitHubトークン）を復号
 * - 保存: GitHub Contents API で news/news.json と画像(news/img/)をコミット
 */
(function () {
    'use strict';

    var NEWS_PATH = 'news/news.json';
    var IMG_DIR = 'news/img/';
    var CONFIG_PATH = 'admin-config.json';
    var KDF_ITER = 250000;

    var $ = function (s) { return document.querySelector(s); };
    var esc = NewsRender.esc;
    var enc = new TextEncoder();
    var dec = new TextDecoder();

    var S = null;          // { owner, repo, branch, token }
    var data = null;       // news.json の内容
    var editing = null;    // 編集中の記事ID（新規なら null）
    var edit = null;       // 編集中の状態 { image, newImageBlob, newImageUrl }

    // ---------- 共通 ----------
    function show(view) {
        ['login', 'setup', 'list', 'edit'].forEach(function (v) {
            $('#view-' + v).classList.toggle('d-none', v !== view);
        });
        $('#btn-logout').classList.toggle('d-none', view === 'login' || view === 'setup');
    }

    function notify(msg, type) {
        var a = $('#alert');
        a.className = 'alert alert-' + (type || 'info');
        a.textContent = msg;
        if (!msg) a.classList.add('d-none');
        else window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function busy(btn, on, label) {
        if (!btn) return;
        if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '処理中...'; btn.disabled = true; }
        else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
    }

    function bytesToB64(u8) {
        var s = '';
        for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function b64ToBytes(b64) {
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    // ---------- 暗号 (PBKDF2 + AES-GCM) ----------
    function deriveKey(pass, salt, iter) {
        return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (km) {
            return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' },
                km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        });
    }
    function encryptToken(token, pass) {
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var iv = crypto.getRandomValues(new Uint8Array(12));
        return deriveKey(pass, salt, KDF_ITER).then(function (key) {
            return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(token));
        }).then(function (ct) {
            return { iter: KDF_ITER, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
        });
    }
    function decryptToken(cfg, pass) {
        return deriveKey(pass, b64ToBytes(cfg.salt), cfg.iter).then(function (key) {
            return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(cfg.iv) }, key, b64ToBytes(cfg.ct));
        }).then(function (pt) { return dec.decode(pt); });
    }

    // ---------- GitHub API ----------
    function gh(path, opts) {
        opts = opts || {};
        return fetch('https://api.github.com/repos/' + S.owner + '/' + S.repo + '/' + path, {
            method: opts.method || 'GET',
            headers: {
                'Accept': 'application/vnd.github+json',
                'Authorization': 'Bearer ' + S.token,
                'Content-Type': 'application/json'
            },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
            cache: 'no-store'
        });
    }
    function apiError(r, what) {
        var hint = r.status === 401 ? '（トークンが無効か期限切れです。管理者に連絡してください）'
            : r.status === 403 || r.status === 404 ? '（トークンの権限またはリポジトリ設定を確認してください）' : '';
        return new Error(what + 'に失敗しました: HTTP ' + r.status + hint);
    }
    function getFile(path) {
        return gh('contents/' + path + '?ref=' + encodeURIComponent(S.branch)).then(function (r) {
            if (r.status === 404) return null;
            if (!r.ok) throw apiError(r, path + ' の取得');
            return r.json();
        });
    }
    function putFile(path, b64, message, sha) {
        var body = { message: message, content: b64, branch: S.branch };
        if (sha) body.sha = sha;
        return gh('contents/' + path, { method: 'PUT', body: body }).then(function (r) {
            if (!r.ok) { var e = apiError(r, path + ' の保存'); e.status = r.status; throw e; }
            return r.json();
        });
    }
    function deleteFile(path, message) {
        return getFile(path).then(function (f) {
            if (!f) return;
            return gh('contents/' + path, { method: 'DELETE', body: { message: message, sha: f.sha, branch: S.branch } });
        });
    }

    // news.json を読み → mutate → 書き戻し。競合(409/422)は最新を取り直して再試行
    function loadNews() {
        return getFile(NEWS_PATH).then(function (f) {
            var d = f ? JSON.parse(dec.decode(b64ToBytes(f.content.replace(/\n/g, '')))) : { categories: [], items: [] };
            d.categories = d.categories || [];
            d.items = d.items || [];
            return { data: d, sha: f ? f.sha : null };
        });
    }
    function updateNews(mutate, message, tries) {
        tries = tries == null ? 3 : tries;
        return loadNews().then(function (cur) {
            mutate(cur.data);
            var text = JSON.stringify(cur.data, null, 2) + '\n';
            return putFile(NEWS_PATH, bytesToB64(enc.encode(text)), message, cur.sha).then(function () {
                data = cur.data;
            }, function (e) {
                if ((e.status === 409 || e.status === 422) && tries > 1) return updateNews(mutate, message, tries - 1);
                throw e;
            });
        });
    }

    // ---------- ログイン / 初期設定 ----------
    function init() {
        if (!window.crypto || !crypto.subtle) {
            notify('この画面は https または localhost で開く必要があります。', 'danger');
            return;
        }
        var saved = null;
        try { saved = JSON.parse(sessionStorage.getItem('adminSession')); } catch (e) { /* 無視 */ }
        if (saved && saved.token) { S = saved; openList(); } else { show('login'); }
    }

    $('#form-login').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = ev.target.querySelector('button');
        busy(btn, true, '確認中...');
        notify('');
        fetch(CONFIG_PATH, { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('NOCONFIG');
            return r.json();
        }).then(function (cfg) {
            return decryptToken(cfg, $('#login-pass').value).then(function (token) {
                S = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: token };
            }, function () { throw new Error('BADPASS'); });
        }).then(function () {
            try { sessionStorage.setItem('adminSession', JSON.stringify(S)); } catch (e) { /* 無視 */ }
            $('#login-pass').value = '';
            return openList();
        }).catch(function (e) {
            if (e.message === 'NOCONFIG') notify('初期設定がまだ行われていません。管理者が「初期設定」を実行してください。', 'warning');
            else if (e.message === 'BADPASS') notify('合言葉が違います。', 'danger');
            else notify(e.message, 'danger');
        }).then(function () { busy(btn, false); });
    });

    $('#link-setup').addEventListener('click', function (ev) {
        ev.preventDefault();
        notify('');
        if (/github\.io$/.test(location.hostname)) {
            $('#s-owner').value = location.hostname.split('.')[0];
            var seg = location.pathname.split('/')[1];
            if (seg && !/\.html$/.test(seg)) $('#s-repo').value = seg;
        }
        show('setup');
    });
    $('#btn-setup-cancel').addEventListener('click', function () { show('login'); });

    $('#form-setup').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var btn = ev.target.querySelector('button[type=submit]');
        var cfg = {
            owner: $('#s-owner').value.trim(), repo: $('#s-repo').value.trim(), branch: $('#s-branch').value.trim()
        };
        var token = $('#s-token').value.trim();
        var pass = $('#s-pass').value;
        S = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, token: token };
        busy(btn, true, '保存中...');
        notify('');
        // トークンが書き込み権限を持つか確認 → 暗号化 → コミット
        gh('').then(function (r) {
            if (!r.ok) throw apiError(r, 'リポジトリの確認');
            return r.json();
        }).then(function (repo) {
            if (repo.permissions && !repo.permissions.push) throw new Error('このトークンには書き込み権限がありません（Contents: Read and write が必要です）。');
            return encryptToken(token, pass);
        }).then(function (c) {
            Object.keys(cfg).forEach(function (k) { c[k] = cfg[k]; });
            return getFile(CONFIG_PATH).then(function (old) {
                return putFile(CONFIG_PATH, bytesToB64(enc.encode(JSON.stringify(c, null, 2) + '\n')),
                    '管理画面: 初期設定を保存', old ? old.sha : null);
            });
        }).then(function () {
            S = null;
            $('#form-setup').reset();
            show('login');
            notify('初期設定を保存しました。サイトへの反映後（1〜2分）、合言葉でログインできます。', 'success');
        }).catch(function (e) {
            S = null;
            notify(e.message, 'danger');
        }).then(function () { busy(btn, false); });
    });

    $('#btn-logout').addEventListener('click', function () {
        try { sessionStorage.removeItem('adminSession'); } catch (e) { /* 無視 */ }
        S = null; data = null;
        notify('');
        show('login');
    });

    // ---------- 一覧 ----------
    function openList() {
        show('list');
        $('#list-body').innerHTML = '<tr><td colspan="5" class="text-muted">読み込み中...</td></tr>';
        return loadNews().then(function (cur) {
            data = cur.data;
            renderList();
        }).catch(function (e) {
            notify(e.message, 'danger');
            if (/HTTP 401/.test(e.message)) $('#btn-logout').click();
        });
    }

    function renderList() {
        var items = NewsRender.sortItems(data.items);
        $('#list-body').innerHTML = items.length ? items.map(function (n) {
            return '<tr><td class="text-nowrap">' + esc(NewsRender.dotDate(n.date)) + '</td>' +
                '<td>' + esc(n.category || '') + '</td>' +
                '<td>' + esc(n.title) + '</td>' +
                '<td>' + (n.draft ? '<span class="badge text-bg-secondary">下書き</span>' : '<span class="badge text-bg-success">公開</span>') + '</td>' +
                '<td class="text-end row-actions"><button class="btn btn-sm btn-outline-primary" data-act="edit" data-id="' + esc(n.id) + '">編集</button> ' +
                '<button class="btn btn-sm btn-outline-danger" data-act="del" data-id="' + esc(n.id) + '">削除</button></td></tr>';
        }).join('') : '<tr><td colspan="5" class="text-muted">まだニュースがありません。</td></tr>';
    }

    $('#list-body').addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-act]');
        if (!b) return;
        var n = data.items.filter(function (x) { return x.id === b.dataset.id; })[0];
        if (!n) return;
        if (b.dataset.act === 'edit') openEditor(n);
        else removeItem(n, b);
    });

    function removeItem(n, btn) {
        if (!confirm('「' + n.title + '」を削除します。この操作は元に戻せません。よろしいですか？')) return;
        busy(btn, true, '削除中...');
        notify('');
        updateNews(function (d) {
            d.items = d.items.filter(function (x) { return x.id !== n.id; });
        }, '管理画面: ニュース削除 ' + n.id).then(function () {
            if (n.image && n.image.indexOf(IMG_DIR) === 0) return deleteFile(n.image, '管理画面: 画像削除 ' + n.id);
        }).then(function () {
            renderList();
            notify('削除しました。サイトへの反映には1〜2分かかります。', 'success');
        }).catch(function (e) {
            busy(btn, false);
            notify(e.message, 'danger');
        });
    }

    // ---------- 編集 ----------
    function today() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function fillCategories(selected) {
        var cats = data.categories.slice();
        if (selected && cats.indexOf(selected) < 0) cats.push(selected);
        $('#f-cat').innerHTML = cats.map(function (c) {
            return '<option value="' + esc(c) + '"' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>';
        }).join('') + '<option value="__new__">＋ 新しいカテゴリ…</option>';
        $('#f-cat-new').classList.add('d-none');
        $('#f-cat-new').value = '';
    }

    function openEditor(n) {
        editing = n ? n.id : null;
        edit = { image: n ? (n.image || '') : '', blob: null, blobUrl: '' };
        $('#edit-heading').textContent = n ? 'ニュースを編集' : 'ニュースを新規作成';
        $('#f-title').value = n ? n.title : '';
        $('#f-date').value = n ? n.date : today();
        $('#f-body').value = n ? n.body : '';
        $('#f-draft').checked = !!(n && n.draft);
        $('#f-image').value = '';
        fillCategories(n ? n.category : data.categories[0]);
        notify('');
        show('edit');
        syncImage();
        renderPreview();
    }

    function currentImageSrc() {
        if (edit.blobUrl) return edit.blobUrl;
        return edit.image ? edit.image : '';
    }
    function syncImage() {
        var src = currentImageSrc();
        $('#img-area').classList.toggle('d-none', !src);
        $('#img-preview').src = src;
    }

    function categoryValue() {
        var v = $('#f-cat').value;
        return v === '__new__' ? $('#f-cat-new').value.trim() : v;
    }

    function renderPreview() {
        var src = currentImageSrc();
        var title = $('#f-title').value || '（タイトル）';
        $('#preview-card').innerHTML =
            '<div class="d-flex align-items-center gap-3 mb-3"><time class="text-muted fw-bold">' + esc(NewsRender.dotDate($('#f-date').value)) + '</time>' +
            (categoryValue() ? '<span class="badge badge-custom-sub px-2 py-1 small fw-normal">' + esc(categoryValue()) + '</span>' : '') + '</div>' +
            '<h2 class="h4 fw-bold text-custom-blue mb-3 pb-3 border-bottom" style="line-height:1.5">' + esc(title) + '</h2>' +
            (src ? '<div class="mb-3 text-center"><img src="' + esc(src) + '" class="img-fluid rounded-3 border shadow-sm" alt="" style="max-height:300px;width:100%;object-fit:cover"></div>' : '') +
            '<div class="news-content text-secondary" style="line-height:1.9">' + NewsRender.renderBody($('#f-body').value, '') + '</div>';
    }

    ['#f-title', '#f-date', '#f-body', '#f-cat-new'].forEach(function (s) { $(s).addEventListener('input', renderPreview); });
    $('#f-cat').addEventListener('change', function () {
        var isNew = this.value === '__new__';
        $('#f-cat-new').classList.toggle('d-none', !isNew);
        if (isNew) $('#f-cat-new').focus();
        renderPreview();
    });

    // 画像: 幅1600px以内のJPEGに縮小
    $('#f-image').addEventListener('change', function () {
        var file = this.files[0];
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { notify('画像は PNG / JPEG / WebP を選んでください。', 'warning'); this.value = ''; return; }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            var max = 1600, scale = Math.min(1, max / img.width);
            var c = document.createElement('canvas');
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            c.toBlob(function (blob) {
                if (edit.blobUrl) URL.revokeObjectURL(edit.blobUrl);
                edit.blob = blob;
                edit.blobUrl = URL.createObjectURL(blob);
                syncImage();
                renderPreview();
            }, 'image/jpeg', 0.85);
        };
        img.onerror = function () { notify('画像を読み込めませんでした。', 'danger'); };
        img.src = url;
    });
    $('#btn-img-remove').addEventListener('click', function () {
        if (edit.blobUrl) URL.revokeObjectURL(edit.blobUrl);
        edit.blob = null; edit.blobUrl = ''; edit.image = '';
        $('#f-image').value = '';
        syncImage();
        renderPreview();
    });

    $('#btn-new').addEventListener('click', function () { openEditor(null); });
    $('#btn-back').addEventListener('click', backToList);
    $('#btn-cancel').addEventListener('click', backToList);
    function backToList() { notify(''); show('list'); renderList(); }

    function uniqueId(date, items) {
        var base = date.replace(/-/g, ''), id = base, n = 2;
        var ids = items.map(function (x) { return x.id; });
        while (ids.indexOf(id) >= 0) id = base + '-' + n++;
        return id;
    }

    $('#form-edit').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var cat = categoryValue();
        if ($('#f-cat').value === '__new__' && !cat) { notify('新しいカテゴリ名を入力してください。', 'warning'); return; }
        var btn = $('#btn-save');
        busy(btn, true, '保存中...');
        notify('');

        var prevImage = editing ? (data.items.filter(function (x) { return x.id === editing; })[0] || {}).image || '' : '';
        var id = editing;
        var imagePath = edit.image;
        var uploaded = Promise.resolve();

        // 新しい画像があれば先にアップロード（名前は毎回ユニーク）
        if (edit.blob) {
            id = id || uniqueId($('#f-date').value, data.items);
            imagePath = IMG_DIR + id + '-' + Date.now().toString(36) + '.jpg';
            uploaded = edit.blob.arrayBuffer().then(function (buf) {
                return putFile(imagePath, bytesToB64(new Uint8Array(buf)), '管理画面: 画像追加 ' + id);
            });
        }

        uploaded.then(function () {
            return updateNews(function (d) {
                id = editing || id || uniqueId($('#f-date').value, d.items);
                var item = {
                    id: id,
                    date: $('#f-date').value,
                    category: cat,
                    title: $('#f-title').value.trim(),
                    image: imagePath,
                    body: $('#f-body').value.replace(/\r\n?/g, '\n').trim()
                };
                if ($('#f-draft').checked) item.draft = true;
                var idx = d.items.map(function (x) { return x.id; }).indexOf(id);
                if (idx >= 0) d.items[idx] = item; else d.items.push(item);
                if (cat && d.categories.indexOf(cat) < 0) d.categories.push(cat);
            }, '管理画面: ニュース' + (editing ? '更新 ' : '追加 ') + (editing || id || ''));
        }).then(function () {
            // 画像を差し替え/削除した場合は古い画像ファイルを掃除
            if (prevImage && prevImage !== imagePath && prevImage.indexOf(IMG_DIR) === 0) {
                return deleteFile(prevImage, '管理画面: 古い画像を削除');
            }
        }).then(function () {
            busy(btn, false);
            show('list');
            renderList();
            notify('保存しました。サイトへの反映には1〜2分かかります。', 'success');
        }).catch(function (e) {
            busy(btn, false);
            notify(e.message, 'danger');
        });
    });

    init();
})();
