/*
 * The supporting line under a heading: a created date, a path, a trunk age.
 *
 * One size and one grey, where the file previously used 11px, 12px and 13px
 * against #6c6f72 and #3c434a more or less at random. Three sizes of grey text
 * on one screen reads as three levels of importance, and there was only ever
 * one — so the differences were saying something untrue.
 *
 * It lays out as a wrapping flex row because that is what every caller does with
 * it: a badge, a date, a dot separator, a path chip. Pass `column` for the cases
 * that stack.
 */

import React from 'react';

/**
 * @param {Object}          props
 * @param {boolean}         [props.column]    Stack the children instead of inlining them.
 * @param {string}          [props.className] Extra classes.
 * @param {React.ReactNode} props.children
 */
export function MetaText( { column = false, className = '', children, ...rest } ) {
	const classes = [ 'wpct-meta', className ].filter( Boolean ).join( ' ' );
	// The one inline style left here, because it is the component's own single
	// axis switch rather than a design decision a token should own.
	const style = column ? { flexDirection: 'column', alignItems: 'flex-start' } : undefined;

	return (
		<div className={ classes } style={ style } { ...rest }>
			{ children }
		</div>
	);
}

export default MetaText;
