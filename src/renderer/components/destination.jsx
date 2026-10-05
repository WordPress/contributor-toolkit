import React from 'react';
import { Card, Stack, Text } from '@wordpress/ui';

// One destination for a finished patch (#166): what it is, what it costs to
// use, and what happens afterwards. The costs are the point — they are what the
// app used to leave the contributor to find out on their own — so every
// destination states one, in the same place and the same shape, rather than the
// cheap one being presented as the obvious choice.
export function Destination({ title, cost, after, children }) {
  return (
    <Stack direction="column" gap="sm">
      <Text variant="heading-md">{title}</Text>
      <Text variant="body-sm">{cost}</Text>
      <Text variant="body-sm" className="muted-label">{after}</Text>
      {/*
        The actions follow the prose rather than being pushed to the bottom of
        the row: the destinations carry different numbers of controls, so
        bottom-aligning them lines up nothing and leaves a hole above the
        shorter one's button.
      */}
      <Stack direction="column" gap="sm" className="destination-actions">{children}</Stack>
    </Stack>
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
    <Card.Root className="destination-group">
      {destinations.map((destination, index) => (
        // Position is the only identity a destination in a fixed list has, and
        // the list is rebuilt whole when it changes.
        <Card.Content key={index}>{destination}</Card.Content>
      ))}
    </Card.Root>
  );
}
