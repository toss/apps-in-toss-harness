import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        padding: '2rem',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      <h1>Hello, mini-app 👋</h1>
      <p>
        커뮤니티 템플릿(<code>react-vite</code>)에서 시작한 빈 프로젝트입니다.
      </p>

      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        style={{ padding: '0.5rem 1rem' }}
      >
        clicked {count} times
      </button>

      <p style={{ marginTop: '2rem', fontSize: 14, color: '#666' }}>다음 단계:</p>
      <ul style={{ fontSize: 14, color: '#666' }}>
        <li>
          <code>src/App.tsx</code>를 수정해서 화면을 바꿔보세요.
        </li>
        <li>
          <code>@apps-in-toss/web-framework</code>의 SDK API를 import해서 호출해보세요. 개발 중에는{' '}
          <code>@ait-co/devtools</code>가 자동으로 mock으로 대체합니다.
        </li>
        <li>
          배포 준비는 순서대로: <code>/ait:setup-bundle</code>(번들 설정) → <code>/ait:design</code>
          (등록 자산) → <code>/ait:register</code>(앱 등록) → <code>/ait:deploy-key</code>(Deploy
          Key 발급) → <code>/ait:deploy</code>(콘솔 업로드).
        </li>
      </ul>
    </main>
  );
}
