import React from 'react';

// One destination for a finished patch (#166): what it is, what it costs to
// use, and what happens afterwards. The costs are the point — they are what the
// app used to leave the contributor to find out on their own — so every
// destination states one, in the same place and the same shape, rather than the
// cheap one being presented as the obvious choice.
export function Destination({ title, cost, after, children }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontWeight:600, fontSize:14, color:'#1d2327' }}>{title}</div>
      <div style={{ fontSize:12, color:'#3c434a', lineHeight:1.5 }}>{cost}</div>
      <div style={{ fontSize:12, color:'#6c6f72', lineHeight:1.5 }}>{after}</div>
      {/*
        The actions follow the prose rather than being pushed to the bottom of
        the row: the destinations carry different numbers of controls, so
        bottom-aligning them lines up nothing and leaves a hole above the
        shorter one's button.
      */}
      <div style={{ paddingTop:4, display:'flex', flexDirection:'column', gap:8 }}>{children}</div>
    </div>
  );
}

// The card around the destinations that ask the same thing of the contributor.
//
// Three equal cards said the three destinations were three variations on one
// choice. They are not: two of them save a file and stop, leaving the
// contributor to carry it somewhere, and the third signs them in and pushes on
// their behalf. That is the fork in the road, and a layout that hides it makes
// the reader rediscover it by reading all three in full.
//
// So the shared card is the grouping, and the hairline between destinations
// inside it says "another way to do the same kind of thing" — as against the
// gap between cards, which says "a different kind of thing". No group heading:
// the line above the grid names the split once, and a heading per card would
// say it twice while pushing the destinations themselves further down.
export function DestinationGroup({ children }) {
  // Filtered because a conditional destination renders as false, and an empty
  // section would draw a divider with nothing under it.
  const destinations = React.Children.toArray(children).filter(Boolean);
  return (
    <div style={{ display:'flex', flexDirection:'column', border:'1px solid #dcdcde', borderRadius:10, background:'#fff' }}>
      {destinations.map((destination, index) => (
        // Position is the only identity a destination in a fixed list has, and
        // the list is rebuilt whole when it changes.
        <div key={index} style={{ padding:'14px 16px', borderTop: index === 0 ? 'none' : '1px solid #dcdcde' }}>
          {destination}
        </div>
      ))}
    </div>
  );
}
