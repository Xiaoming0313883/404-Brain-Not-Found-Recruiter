import logoUrl from '../../assets/404hire-logo.jpeg';

interface BrandLogoProps {
  className?: string;
  imageClassName?: string;
  showWordmark?: boolean;
}

export function BrandLogo({ className = '', imageClassName = '', showWordmark = true }: BrandLogoProps) {
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <img
        src={logoUrl}
        alt="404Hire"
        className={`h-10 w-auto object-contain mix-blend-multiply ${imageClassName}`}
      />
      {!showWordmark && <span className="sr-only">404Hire</span>}
    </div>
  );
}
