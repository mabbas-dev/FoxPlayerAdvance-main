import React from 'react';
import Svg, { Path, Rect, Circle, Polygon, G, Line, Text as SvgText } from 'react-native-svg';
import Colors from '../constants/colors';

export function TvPlayIcon({ size = 48, color = Colors.brand.primary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 3L12 7L16 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="2" y="7" width="20" height="14" rx="3" stroke={color} strokeWidth="2" />
      <Polygon points="10,10.5 15,14 10,17.5" fill={color} />
    </Svg>
  );
}

export function MovieClapperIcon({ size = 48, color = Colors.brand.primary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 4H20C21.1 4 22 4.9 22 6V18C22 19.1 21.1 20 20 20H4C2.9 20 2 19.1 2 18V6C2 4.9 2.9 4 4 4Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M2 9H22" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M7 4L5 9" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M12 4L10 9" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M17 4L15 9" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function SeriesFilmIcon({ size = 48, color = Colors.brand.primary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="3" width="18" height="18" rx="3" stroke={color} strokeWidth="2" />
      <Path d="M8 3V21" stroke={color} strokeWidth="2" />
      <Path d="M16 3V21" stroke={color} strokeWidth="2" />
      <Path d="M3 8H8" stroke={color} strokeWidth="2" />
      <Path d="M3 13H8" stroke={color} strokeWidth="2" />
      <Path d="M3 18H8" stroke={color} strokeWidth="2" />
      <Path d="M16 8H21" stroke={color} strokeWidth="2" />
      <Path d="M16 13H21" stroke={color} strokeWidth="2" />
      <Path d="M16 18H21" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

export function StarIcon({ size = 48, color = Colors.brand.primary, filled = true }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'}>
      <Path
        d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function RefreshIcon({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M21.5 2V7H16.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2.5 12C2.5 6.75 6.75 2.5 12 2.5C15.86 2.5 19.16 4.79 20.66 8.08L21.5 7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2.5 22V17H7.5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M21.5 12C21.5 17.25 17.25 21.5 12 21.5C8.14 21.5 4.84 19.21 3.34 15.92L2.5 17" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function UserIcon({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M20 21V19C20 16.7909 18.2091 15 16 15H8C5.79086 15 4 16.7909 4 19V21" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="12" cy="7" r="4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function GearIcon({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth="2" />
      <Path
        d="M19.4 15A1.65 1.65 0 0 0 19.73 16.82L20.08 17.17A2 2 0 1 1 17.25 20L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14 20.87V21.5A2 2 0 1 1 10 21.5V20.87A1.65 1.65 0 0 0 8.92 19.32A1.65 1.65 0 0 0 7.1 19.65L6.75 20A2 2 0 1 1 3.92 17.17L4.27 16.82A1.65 1.65 0 0 0 3.94 15A1.65 1.65 0 0 0 2.39 13.92H1.76A2 2 0 1 1 1.76 9.92H2.39A1.65 1.65 0 0 0 3.94 8.84A1.65 1.65 0 0 0 3.61 7.02L3.26 6.67A2 2 0 1 1 6.09 3.84L6.44 4.19A1.65 1.65 0 0 0 8.26 4.52A1.65 1.65 0 0 0 9.34 2.97V2.34A2 2 0 1 1 13.34 2.34V2.97A1.65 1.65 0 0 0 14.42 4.52A1.65 1.65 0 0 0 16.24 4.19L16.59 3.84A2 2 0 1 1 19.42 6.67L19.07 7.02A1.65 1.65 0 0 0 19.4 8.84A1.65 1.65 0 0 0 20.95 9.92H21.58A2 2 0 1 1 21.58 13.92H20.95A1.65 1.65 0 0 0 19.4 15Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CheckCircleIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
      <Path d="M8 12L11 15L16 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CalendarIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth="2" />
      <Path d="M16 2V6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M8 2V6" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M3 10H21" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function BackArrowIcon({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 14L4 9L9 4" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 20V13C20 10.7909 18.2091 9 16 9H4" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function HeartIcon({ size = 20, color = '#FFFFFF', filled = false }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? '#EF4444' : 'none'}>
      <Path
        d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
        stroke={filled ? '#EF4444' : color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlayIcon({ size = 28, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Polygon points="5,3 19,12 5,21" />
    </Svg>
  );
}

export function PauseIcon({ size = 28, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x="6" y="4" width="4" height="16" rx="1" />
      <Rect x="14" y="4" width="4" height="16" rx="1" />
    </Svg>
  );
}

export function FullscreenIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function MinimizeIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 14h6v6m10-10h-6V4m0 6 7-7M9 15l-7 7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function SearchIcon({ size = 18, color = '#9BA3B2' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M21 21L16.65 16.65" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CloseIcon({ size = 16, color = '#9BA3B2' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M18 6L6 18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6 6L18 18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function Rewind10Icon({ size = 28, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C15.8 20 19 17.33 19.8 13.75" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Polyline points="8 4 4 4 4 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M10 10V15M13 11C13 10.45 13.45 10 14 10H14.5C15.05 10 15.5 10.45 15.5 11V14C15.5 14.55 15.05 15 14.5 15H14C13.45 15 13 14.55 13 14V11Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function Forward10Icon({ size = 28, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20C8.2 20 5 17.33 4.2 13.75" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Polyline points="16 4 20 4 20 8" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M10 10V15M13 11C13 10.45 13.45 10 14 10H14.5C15.05 10 15.5 10.45 15.5 11V14C15.5 14.55 15.05 15 14.5 15H14C13.45 15 13 14.55 13 14V11Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

function Polyline({ points, stroke, strokeWidth, strokeLinecap, strokeLinejoin, fill }) {
  return <Path d={`M ${points.replace(/,/g, ' ')}`} stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} strokeLinejoin={strokeLinejoin} fill={fill || 'none'} />;
}

export function VolumeLowIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill={color} />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function VolumeMediumIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill={color} />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M18.5 6.5a8 8 0 0 1 0 11" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function VolumeHighIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill={color} />
      <Path d="M15.54 8.46a5 5 0 0 1 0 7.07" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Path d="M19.07 4.93a10 10 0 0 1 0 14.14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function VolumeMuteIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="11,5 6,9 2,9 2,15 6,15 11,19" fill={color} />
      <Line x1="23" y1="9" x2="17" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="17" y1="9" x2="23" y2="15" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function SunIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="4.5" stroke={color} strokeWidth="2" />
      <Line x1="12" y1="1.5" x2="12" y2="4.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="12" y1="19.5" x2="12" y2="22.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="4.5" y1="4.5" x2="6.7" y2="6.7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="17.3" y1="17.3" x2="19.5" y2="19.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="1.5" y1="12" x2="4.5" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="19.5" y1="12" x2="22.5" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="4.5" y1="19.5" x2="6.7" y2="17.3" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="17.3" y1="6.7" x2="19.5" y2="4.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function SunLowIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3.5" stroke={color} strokeWidth="2" />
      <Line x1="12" y1="3" x2="12" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="12" y1="19" x2="12" y2="21" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="3" y1="12" x2="5" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="19" y1="12" x2="21" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function SpeedIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
      <Path d="M12 6V12L16 14" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

export function AspectRatioIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="5" width="20" height="14" rx="2" stroke={color} strokeWidth="2" />
      <Path d="M7 9H9V7" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M17 15H15V17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function BrokenVideoIcon({ size = 64, color = '#64748B' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="4" width="20" height="15" rx="3" stroke={color} strokeWidth="1.5" />
      <Path d="M8 21H16" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M12 19V21" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Path d="M3 5L21 18" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <Polygon points="9.5,8 14.5,11.5 9.5,15" stroke={color} strokeWidth="1.2" fill="none" opacity="0.4" />
    </Svg>
  );
}

export function WarningToastIcon({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
      <Line x1="12" y1="8" x2="12" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1" fill={color} />
    </Svg>
  );
}



export function CheckIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 6L9 17L4 12"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function TrashIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 6H5H21" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M19 6V20C19 21.1 18.1 22 17 22H7C5.9 22 5 21.1 5 20V6M8 6V4C8 2.9 8.9 2 10 2H14C15.1 2 16 2.9 16 4V6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PauseFilledIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
      <Rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
    </Svg>
  );
}

export function PlayFilledIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="5,3 19,12 5,21" fill={color} />
    </Svg>
  );
}

export function ChevronDownIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 9L12 15L18 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function PlusIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 5V19M5 12H19" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function LayersIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="12,2 2,7 12,12 22,7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2 17L12 22L22 17" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M2 12L12 17L22 12" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function AlertCircleIcon({ size = 18, color = '#EF4444' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" />
      <Line x1="12" y1="8" x2="12" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Circle cx="12" cy="16" r="1" fill={color} />
    </Svg>
  );
}

export function LockIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function UnlockIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7 11V7a5 5 0 0 1 9.9-1" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ShieldIcon({ size = 24, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ClockIcon({ size = 24, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 6V12L16 14" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function AudioTrackIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M3 18V12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12V18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Rect x="2" y="14" width="4" height="7" rx="2" stroke={color} strokeWidth="2" fill="none" />
      <Rect x="18" y="14" width="4" height="7" rx="2" stroke={color} strokeWidth="2" fill="none" />
    </Svg>
  );
}

export function SubtitleTrackIcon({ size = 20, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="4" width="20" height="16" rx="3" stroke={color} strokeWidth="2" />
      <Path d="M7 15h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2H7" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <Path d="M14 15h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </Svg>
  );
}

export function CloseXIcon({ size = 18, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CopyIcon({ size = 16, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="9" y="9" width="13" height="13" rx="2" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}



