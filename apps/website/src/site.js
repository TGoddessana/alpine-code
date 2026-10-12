for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = '복사했어요';
      if (status) status.textContent = '설치 명령을 복사했습니다.';
      setTimeout(() => {
        button.textContent = '복사';
      }, 2000);
    } catch {
      if (status) status.textContent = '복사하지 못했습니다. 표시된 명령을 직접 선택해 복사해주세요.';
    }
  });
}
