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