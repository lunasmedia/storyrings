import { StyleSheet, View } from 'react-native';

/** Small icons drawn with plain views, so the SDK needs no icon or SVG library. */
const C = '#fff';

export function CloseIcon() {
  return (
    <View style={s.box}>
      <View style={[s.bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[s.bar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

export function PauseIcon() {
  return (
    <View style={[s.box, s.row]}>
      <View style={s.pause} />
      <View style={s.pause} />
    </View>
  );
}

export function PlayIcon() {
  return (
    <View style={s.box}>
      <View style={s.play} />
    </View>
  );
}

/** A tray with an arrow coming out of it (the platforms' usual share mark). */
export function ShareIcon() {
  return (
    <View style={s.box}>
      <View style={s.shareTray} />
      <View style={s.shareShaft} />
      <View style={s.shareHead} />
    </View>
  );
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <View style={[s.box, s.row, { gap: 1 }]}>
      <View style={s.speakerBody} />
      <View style={s.speakerCone} />
      {muted ? (
        <View style={s.cross}>
          <View style={[s.crossBar, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[s.crossBar, { transform: [{ rotate: '-45deg' }] }]} />
        </View>
      ) : (
        <View style={s.wave} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 4 },
  bar: { position: 'absolute', width: 20, height: 2.5, borderRadius: 1, backgroundColor: C },
  pause: { width: 4, height: 15, borderRadius: 1, backgroundColor: C },
  play: {
    marginLeft: 3,
    borderLeftWidth: 13,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: C,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  speakerBody: { width: 4, height: 7, backgroundColor: C, borderRadius: 1 },
  speakerCone: {
    marginLeft: -2,
    borderRightWidth: 7,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderRightColor: C,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  wave: {
    width: 7,
    height: 12,
    borderWidth: 2,
    borderColor: C,
    borderLeftColor: 'transparent',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  shareTray: {
    position: 'absolute',
    bottom: 1,
    width: 14,
    height: 9,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: C,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
  shareShaft: { position: 'absolute', top: 2, width: 2, height: 11, backgroundColor: C },
  shareHead: {
    position: 'absolute',
    top: 2,
    width: 7,
    height: 7,
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderColor: C,
    transform: [{ rotate: '45deg' }],
  },
  cross: { width: 9, height: 9, alignItems: 'center', justifyContent: 'center' },
  crossBar: { position: 'absolute', width: 10, height: 2, backgroundColor: C },
});
