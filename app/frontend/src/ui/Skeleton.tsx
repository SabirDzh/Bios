import './Skeleton.css';

interface SkeletonProps {
  w?: number | string;
  h?: number | string;
  lines?: number;
}

export function Skeleton({ w = '100%', h = 14, lines = 1 }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className="skeleton-lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <div
            key={index}
            className="skeleton"
            style={{ width: index === lines - 1 ? '60%' : w, height: h }}
          />
        ))}
      </div>
    );
  }
  return <div className="skeleton" style={{ width: w, height: h }} aria-hidden="true" />;
}
