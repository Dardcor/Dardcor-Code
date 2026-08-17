type DardcorCodeLogoProps = {
  size?: number;
  className?: string;
};

export default function DardcorCodeLogo({ size = 20, className = "" }: DardcorCodeLogoProps) {
  return (
    <img
      src="/dardcor-code.png"
      alt="Dardcor Code"
      width={size}
      height={size}
      className={`rounded object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
