import { siGithub, siGoogle } from 'simple-icons';
import { Button } from '../../ui/Button';
function BrandIcon({
  path,
  label,
  color,
}: {
  path: string;
  label: string;
  color?: string;
}) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill={color ?? 'currentColor'}
      role="img"
      aria-label={label}
    >
      <path d={path} />
    </svg>
  );
}

/**
 * Заглушка социального входа: бэкенд OAuth ещё не умеет, поэтому кнопки
 * задизейблены с честным тултипом. Убрать disabled — когда появится API.
 */
export function AuthSocial() {
  return (
    <>
      <div className="auth-social">
        <Button
          variant="default"
          className="auth-social-btn"
          disabled
          title="Вход через Google — скоро"
          icon={<BrandIcon path={siGoogle.path} label="Google" />}
        >
          Google
        </Button>
        <Button
          variant="default"
          className="auth-social-btn"
          disabled
          title="Вход через GitHub — скоро"
          icon={<BrandIcon path={siGithub.path} label="GitHub" />}
        >
          GitHub
        </Button>
      </div>
      <div className="auth-or" aria-hidden>
        <span>или</span>
      </div>
    </>
  );
}
