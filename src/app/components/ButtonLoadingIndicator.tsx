import { useEffect } from 'react';

const BUTTON_LOADING_DURATION_MS = 700;

export function ButtonLoadingIndicator() {
  useEffect(() => {
    const timers = new WeakMap<HTMLButtonElement, number>();

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');

      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') {
        return;
      }

      const previousTimer = timers.get(button);
      if (previousTimer) {
        window.clearTimeout(previousTimer);
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (
            !button.isConnected ||
            button.dataset.clickLoadingIgnore === 'true' ||
            button.querySelector('.animate-spin')
          ) {
            return;
          }

          const isIconOnly = !button.textContent?.trim() || (button.offsetWidth <= 44 && button.offsetHeight <= 44);
          button.dataset.clickLoading = 'true';
          if (isIconOnly) {
            button.dataset.clickLoadingIcon = 'true';
          } else {
            delete button.dataset.clickLoadingIcon;
          }

          const timer = window.setTimeout(() => {
            delete button.dataset.clickLoading;
            delete button.dataset.clickLoadingIcon;
          }, BUTTON_LOADING_DURATION_MS);

          timers.set(button, timer);
        });
      });
    };

    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
    };
  }, []);

  return null;
}
