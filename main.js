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