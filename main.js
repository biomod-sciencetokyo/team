document.addEventListener('DOMContentLoaded', () => {
    
    // 現在のURLに '/news/' が含まれているか判定し、基準となるパスを決める
    const basePath = window.location.pathname.includes('/news/') ? '../' : './';

    // ヘッダーの読み込み
    fetch(basePath + 'header.html')
        .then(response => response.text())
        .then(data => {
            // newsフォルダから読み込んだ場合はパスを1階層上に書き換える
            if (basePath === '../') {
                data = data.replace(/href="([^"]*\.html)"/g, 'href="../$1"');
                data = data.replace(/src="img\//g, 'src="../img/');
                data = data.replace(/src="logo\//g, 'src="../logo/');
            }

            const headerPlaceholder = document.getElementById('header-placeholder');
            if (headerPlaceholder) {
                headerPlaceholder.innerHTML = data;

                // ===== 現在のページに合わせてナビゲーションをハイライトする処理 =====
                
                // 現在のURLからファイル名を取得（例: "about-biomod.html"）
                // フォルダパス等で終わっている場合は "index.html" をデフォルトとする
                const currentPath = window.location.pathname;
                const currentPage = currentPath.substring(currentPath.lastIndexOf('/') + 1) || 'index.html';

                // ヘッダー内のすべてのリンク（.nav-link）を取得
                const navLinks = headerPlaceholder.querySelectorAll('.nav-link');
                
                // ダーク/ライト切り替えボタンを有効化
                setupThemeToggle(headerPlaceholder.querySelector('#theme-toggle'));

                // ナビバーの実際の高さを --nav-h に反映（リンクが折り返して段数が増えても本文が隠れないように）
                const nav = headerPlaceholder.querySelector('nav');
                if (nav && 'ResizeObserver' in window) {
                    new ResizeObserver(() => {
                        document.documentElement.style.setProperty('--nav-h', nav.offsetHeight + 'px');
                    }).observe(nav);
                }

                // スクロールしたらヘッダーをガラス風に（トップページでは最上部だけ透明）
                if (nav) {
                    const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
                    onScroll();
                    window.addEventListener('scroll', onScroll, { passive: true });
                }

                navLinks.forEach(link => {
                    // まず、初期状態として設定されている可能性のある active クラスをすべて外す
                    link.classList.remove('active');
                    
                    // リンク先のhref属性からファイル名のみを抽出
                    const href = link.getAttribute('href');
                    const linkPage = href.substring(href.lastIndexOf('/') + 1);

                    // 現在のファイル名とリンク先のファイル名が一致していれば active を付与
                    if (currentPage === linkPage) {
                        link.classList.add('active');
                    }
                });
            }
        });

    // フッターの読み込み
    fetch(basePath + 'footer.html')
        .then(response => response.text())
        .then(data => {
            // ヘッダーと同様に、newsフォルダから読み込んだ場合はパスを1階層上に書き換える
            if (basePath === '../') {
                data = data.replace(/href="([^"]*\.html)"/g, 'href="../$1"');
                data = data.replace(/src="img\//g, 'src="../img/');
            }
            
            const footerPlaceholder = document.getElementById('footer-placeholder');
            if (footerPlaceholder) {
                footerPlaceholder.innerHTML = data;
            }
        });

    // スクロールアニメーション
    const sections = document.querySelectorAll('.fade-in-section');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1 });

    sections.forEach(section => observer.observe(section));
});

// ===== ダークモード / ライトモード切り替え =====
// 初期テーマは各ページの<head>内のスクリプトで設定済み（ちらつき防止のため）。
// ここではボタン操作と、OS設定の変更への追従を担当する。
const THEME_KEY = 'theme';

function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        const label = theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
    }
}

function setupThemeToggle(btn) {
    if (!btn) return;
    applyTheme(document.documentElement.getAttribute('data-bs-theme') || 'light');
    btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 保存できない環境では無視 */ }
    });
}

// ユーザーがボタンで選んでいない場合は、OSのダーク/ライト設定の変更に追従する
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* 無視 */ }
    if (!saved) applyTheme(e.matches ? 'dark' : 'light');
});
// ===== メッセージウィンドウ（RPG風のセリフ送り）とキャラクターのポーズ =====
// data-typing を付けたウィンドウの中の <ol class="msg-lines"> のセリフを順番に表示する。
// ・文字は1文字ずつ表示（動きを減らす設定の人には全文を一度に表示）
// ・ウィンドウかキャラクターをクリック/タップ（Enter/スペースも可）で次のセリフへ。表示中なら全文を表示
// ・最後のセリフの次は最初に戻る
// ・<li data-pose="jump"> でそのセリフのポーズを指定。画像は <img data-pose-名前="パス|長さms">
//   （長さを書いたポーズは1回だけ再生して、話し中なら talk、話し終わっていれば idle に戻る）
document.addEventListener('DOMContentLoaded', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelectorAll('[data-typing]').forEach(win => {
        const p = win.querySelector('p');
        if (!p) return;
        const items = Array.from(win.querySelectorAll('.msg-lines li'));
        const lines = items.length ? items.map(li => ({ text: li.textContent.trim(), pose: li.dataset.pose || 'talk' }))
                                   : [{ text: p.textContent.trim(), pose: 'talk' }];
        const scene = win.closest('.msg-scene');
        const count = win.querySelector('.msg-count');
        const chara = scene ? scene.querySelector('.hero-chara') : null;

        // ---- ポーズ（GIF）の管理 ----
        const poses = {};
        if (chara) {
            Object.keys(chara.dataset).forEach(key => {
                if (!key.startsWith('pose')) return;
                const name = key.slice(4).toLowerCase();
                const [src, ms] = chara.dataset[key].split('|');
                poses[name] = { src, ms: ms ? Number(ms) : 0, blob: null };
                // GIFを毎回最初から再生できるよう、先に読み込んでおく（失敗したら通常の読み込みで代用）
                fetch(src).then(r => r.ok ? r.blob() : null).then(b => { poses[name].blob = b; }).catch(() => {});
            });
        }
        let objectUrl = null, poseTimer = null, poseEnd = 0;
        const setPose = name => {
            const pose = poses[name];
            if (!chara || !pose) return;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = pose.blob ? URL.createObjectURL(pose.blob) : null;
            chara.src = objectUrl || pose.src;
        };
        const play = name => {
            clearTimeout(poseTimer);
            if (!poses[name]) name = 'talk';
            setPose(name);
            const ms = poses[name] ? poses[name].ms : 0;
            poseEnd = Date.now() + ms;
            if (ms) poseTimer = setTimeout(() => setPose(timer ? 'talk' : 'idle'), ms);
        };

        // ---- セリフの表示 ----
        let index = 0, pos = 0, timer = null;
        const setTalking = on => {
            win.classList.toggle('is-typing', on);
            if (scene) scene.classList.toggle('is-talking', on);
        };
        const finish = () => {
            clearInterval(timer); timer = null;
            p.textContent = lines[index].text;
            setTalking(false);
            // 1回だけのポーズ（ジャンプなど）は最後まで見せてから待機に戻る
            const rest = poseEnd - Date.now();
            if (rest <= 0) setPose('idle');
        };
        const show = i => {
            index = i; pos = 0;
            if (count) count.textContent = lines.length > 1 ? (index + 1) + '/' + lines.length : '';
            play(lines[index].pose);
            if (reduce) { p.textContent = lines[index].text; finish(); return; }
            p.textContent = '';
            setTalking(true);
            clearInterval(timer);
            timer = setInterval(() => {
                p.textContent = lines[index].text.slice(0, ++pos);
                if (pos >= lines[index].text.length) finish();
            }, 45);
        };
        const next = () => {
            if (timer) finish();                               // 表示中なら全文を出すだけ
            else show((index + 1) % lines.length);             // 表示し終わっていれば次のセリフへ
        };

        win.addEventListener('click', next);
        if (chara) chara.addEventListener('click', next);
        win.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
        });

        // 最初のセリフは、ウィンドウが画面に入ってから表示を始める
        p.textContent = reduce ? lines[0].text : '';
        const io = new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) { io.disconnect(); setTimeout(() => show(0), 600); }
        });
        io.observe(win);
    });
});

// ===== キャラクター動画のセリフを、動画のループの頭に合わせる =====
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.chara-visual.is-video video').forEach(video => {
        const speech = video.parentElement.querySelector('.chara-speech');
        if (!speech) return;
        video.addEventListener('playing', () => {
            speech.style.animation = 'none';
            void speech.offsetWidth;          // アニメーションを最初からやり直す
            speech.style.animation = '';
        });
    });
});
