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

// =====================================================================
// サイト全体の動き（モーション）
// ・スクロール進捗バー / 見出しの1文字ずつの登場 / 袋文字の横スライド
// ・パララックス（data-parallax="0.2" のように係数を指定。正で遅く、負で速く動く）
// ・カードの順番表示（.stagger の子要素）/ カードの立体的な傾き / ボタンの吸い寄せ
// ・横スクロールの年表（[data-hscroll]）
// 「視差効果を減らす」設定（prefers-reduced-motion）の人には、動きを止めて普通に表示する
// =====================================================================
(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const root = document.documentElement;
    if (!reduce) root.classList.add('js-motion');

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const navH = () => parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 68;

    // スクロールのたびに呼ぶ処理をまとめて、1フレームに1回だけ実行する
    const onFrame = [];
    let ticking = false;
    const requestTick = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; onFrame.forEach(fn => fn()); });
    };
    window.addEventListener('scroll', requestTick, { passive: true });
    window.addEventListener('resize', requestTick);

    document.addEventListener('DOMContentLoaded', () => {

        // ---- スクロール進捗バー ----
        const bar = document.createElement('div');
        bar.className = 'scroll-progress';
        bar.setAttribute('aria-hidden', 'true');
        document.body.appendChild(bar);
        onFrame.push(() => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            bar.style.transform = `scaleX(${max > 0 ? clamp(window.scrollY / max, 0, 1) : 0})`;
        });

        // ---- 見出しを1文字ずつ登場させる（単語の途中で改行しないよう、単語ごとにまとめる） ----
        const splitIO = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) { e.target.classList.add('is-in'); splitIO.unobserve(e.target); }
            });
        }, { threshold: 0.4 });
        document.querySelectorAll('.sec-title, .page-hero-title').forEach(el => {
            if (reduce || el.children.length || !el.textContent.trim()) return;
            const text = el.textContent.trim();
            el.setAttribute('aria-label', text);
            el.textContent = '';
            let i = 0;
            text.split(/(\s+)/).forEach(part => {
                if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(' ')); return; }
                const word = document.createElement('span');
                word.className = 'split-word';
                word.setAttribute('aria-hidden', 'true');
                [...part].forEach(ch => {
                    const s = document.createElement('span');
                    s.className = 'split-ch';
                    s.style.setProperty('--i', i++);
                    s.textContent = ch;
                    word.appendChild(s);
                });
                el.appendChild(word);
            });
            el.classList.add('split');
            splitIO.observe(el);
        });

        // ---- 子要素を順番に表示する ----
        const staggerIO = new IntersectionObserver(entries => {
            entries.forEach(e => {
                if (e.isIntersecting) { e.target.classList.add('is-in'); staggerIO.unobserve(e.target); }
            });
        }, { threshold: 0.15 });
        document.querySelectorAll('.stagger, .member-grid, .sns-row, .feature-meta, .team-steps, .cal-items').forEach(el => {
            el.classList.add('stagger');
            [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
            if (reduce) el.classList.add('is-in'); else staggerIO.observe(el);
        });

        if (reduce) return;   // ここから下は動きだけの演出

        // ---- パララックス ----
        document.querySelectorAll('.hero-bg').forEach(el => el.dataset.parallax ??= '0.35');
        document.querySelectorAll('.page-hero-inner').forEach(el => el.dataset.parallax ??= '0.3');
        document.querySelectorAll('.mosaic img').forEach((el, i) => el.dataset.parallax ??= ['-0.06', '0.08', '-0.12'][i % 3]);
        const parallaxEls = [...document.querySelectorAll('[data-parallax]')];
        const titleBgs = [...document.querySelectorAll('.sec-title[data-bg]')];
        onFrame.push(() => {
            const vh = window.innerHeight;
            parallaxEls.forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.bottom < -200 || r.top > vh + 200) return;
                const k = parseFloat(el.dataset.parallax) || 0;
                // ページ最上部の要素（ヒーロー）はスクロール量そのもの、それ以外は画面中央からのずれに比例
                const base = el.closest('.hero, .page-hero') ? window.scrollY : (r.top + r.height / 2 - vh / 2) * -1;
                el.style.translate = `0 ${(base * k).toFixed(1)}px`;
            });
            titleBgs.forEach(el => {
                const r = el.getBoundingClientRect();
                if (r.bottom < -200 || r.top > vh + 200) return;
                el.style.setProperty('--bg-shift', `${((r.top - vh / 2) * 0.25).toFixed(1)}px`);
            });
        });

        // ---- カードの立体的な傾き（マウス操作の端末だけ） ----
        if (finePointer) {
            document.querySelectorAll('.award-card, .photo-tile, .member-card, .sns-big, .team-photo, .chara-card').forEach(card => {
                card.classList.add('tilt');
                card.addEventListener('pointermove', e => {
                    const r = card.getBoundingClientRect();
                    const x = (e.clientX - r.left) / r.width - 0.5;
                    const y = (e.clientY - r.top) / r.height - 0.5;
                    card.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
                    card.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
                    card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
                    card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
                    card.classList.add('is-tilting');
                });
                card.addEventListener('pointerleave', () => {
                    card.classList.remove('is-tilting');
                    card.style.removeProperty('--rx');
                    card.style.removeProperty('--ry');
                });
            });

            // ---- ボタンがカーソルに少し吸い寄せられる ----
            document.querySelectorAll('.btn-sb').forEach(btn => {
                btn.addEventListener('pointermove', e => {
                    const r = btn.getBoundingClientRect();
                    btn.style.translate = `${((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * 0.3).toFixed(1)}px`;
                });
                btn.addEventListener('pointerleave', () => { btn.style.translate = ''; });
            });
        }
    });

    // ---- 横スクロールの年表 ----
    // 普通の横スクロール（カードが1枚ずつ止まる）。画面を固定したり、縦スクロールで動かしたりはしない
    // ・スマホ：指でスワイプ / PC：矢印・年のボタン・トラックパッドの横スクロール・マウスでドラッグ
    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-hscroll]').forEach(sec => {
            const vp = sec.querySelector('.hscroll-viewport');
            const cards = [...sec.querySelector('.hscroll-track').children].filter(c => !c.classList.contains('hscroll-gap'));
            const fill = sec.querySelector('.hscroll-bar span');
            const steps = [...sec.querySelectorAll('[data-hscroll-to]')];
            const prev = sec.querySelector('[data-hscroll-prev]');
            const next = sec.querySelector('[data-hscroll-next]');
            let current = 0;

            const goTo = i => {
                const card = cards[clamp(i, 0, cards.length - 1)];
                vp.scrollTo({ left: card.offsetLeft - (vp.clientWidth - card.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
            };

            const update = () => {
                const m = vp.scrollWidth - vp.clientWidth;
                if (fill) fill.style.transform = `scaleX(${m > 0 ? vp.scrollLeft / m : 0})`;
                // 画面の真ん中に一番近いカードを「今の年」にする
                const mid = vp.scrollLeft + vp.clientWidth / 2;
                let bestD = Infinity;
                cards.forEach((c, i) => {
                    const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
                    if (d < bestD) { bestD = d; current = i; }
                });
                cards.forEach((c, i) => c.classList.toggle('is-current', i === current));
                steps.forEach((s, i) => s.classList.toggle('is-current', i === current));
                if (prev) prev.disabled = current === 0;
                if (next) next.disabled = current === cards.length - 1;
            };

            steps.forEach((btn, i) => btn.addEventListener('click', () => goTo(i)));
            if (prev) prev.addEventListener('click', () => goTo(current - 1));
            if (next) next.addEventListener('click', () => goTo(current + 1));
            vp.addEventListener('keydown', e => {
                if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1); }
                if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1); }
            });
            // カードをクリックすると、そのカードを真ん中へ
            cards.forEach((c, i) => c.addEventListener('click', () => { if (!dragged) goTo(i); }));

            // マウスでドラッグして動かす（タッチ操作は端末のスワイプに任せる）
            let dragging = false, dragged = false, startX = 0, startLeft = 0;
            vp.addEventListener('pointerdown', e => {
                if (e.pointerType !== 'mouse' || e.button !== 0) return;
                dragging = true; dragged = false; startX = e.clientX; startLeft = vp.scrollLeft;
            });
            window.addEventListener('pointermove', e => {
                if (!dragging) return;
                const dx = e.clientX - startX;
                if (!dragged && Math.abs(dx) > 5) { dragged = true; vp.classList.add('is-dragging'); }
                if (dragged) vp.scrollLeft = startLeft - dx;
            });
            window.addEventListener('pointerup', () => {
                if (!dragging) return;
                dragging = false;
                vp.classList.remove('is-dragging');
                if (dragged) { goTo(current); setTimeout(() => { dragged = false; }, 0); }
            });

            vp.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });

            // 最初は一番右（最新の年）を表示。画面幅が変わっても今の年を真ん中に保つ
            const center = i => {
                const card = cards[i];
                const prevSnap = vp.style.scrollSnapType;
                vp.style.scrollSnapType = 'none';
                vp.scrollLeft = card.offsetLeft - (vp.clientWidth - card.offsetWidth) / 2;
                vp.style.scrollSnapType = prevSnap;
                update();
            };
            current = cards.length - 1;
            center(current);
            window.addEventListener('resize', () => center(current));
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => center(current));
        });

        requestTick();
    });
})();
