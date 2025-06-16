# Styling Guide

Learn how to customize your blog's appearance using VibeLog's AI-powered styling system.

## AI-Powered Styling

VibeLog uses AI to transform your blog's appearance based on natural language prompts. Simply describe the look you want, and the AI will generate appropriate CSS.

### How It Works

1. Start the development server: `vibelog dev`
2. Open the VibeLog panel in your browser
3. Enter styling prompts in natural language
4. See changes applied in real-time
5. Build your site to preserve the styling

### Effective Prompts

#### Color Themes

```text
"dark theme with purple accents"
"minimal white background with blue links"
"warm orange and brown autumn colors"
"corporate blue and gray professional look"
"vibrant pink and green neon theme"
```

#### Style Approaches

```text
"minimalist design with lots of whitespace"
"retro 80s aesthetic with bold colors"
"modern flat design with subtle shadows"
"classic newspaper layout with serif fonts"
"tech blog style with monospace highlights"
```

#### Specific Elements

```text
"rounded corners and soft shadows"
"bold typography with large headers"
"subtle gradients and smooth transitions"
"high contrast for better accessibility"
"mobile-first responsive design"
```

### Best Practices

1. **Be Specific**: Instead of "make it look nice", try "clean minimal design with blue accents"
2. **Iterate Gradually**: Make small changes and build upon them
3. **Consider Accessibility**: Mention contrast and readability in your prompts
4. **Test on Mobile**: Always check how your design looks on different screen sizes

## Manual Customization

While AI styling is the primary feature, you can also manually customize your blog after generation.

### CSS Variables

VibeLog uses CSS custom properties that you can override:

```css
:root {
  --primary-color: #your-color;
  --background-color: #your-bg;
  --text-color: #your-text;
  --accent-color: #your-accent;
}
```

### Custom CSS

Add custom styles to your generated Astro project:

1. Navigate to `.vibelog/src/styles/`
2. Edit or add CSS files
3. Import them in your components or layouts

### Component Customization

Modify the generated Astro components:

- **Header**: `.vibelog/src/components/Header.astro`
- **Footer**: `.vibelog/src/components/Footer.astro`
- **Layout**: `.vibelog/src/layouts/BlogPost.astro`

## Design Inspiration

### Popular Themes

#### Minimalist

- Clean typography
- Lots of whitespace
- Subtle colors
- Focus on content

#### Dark Mode

- Dark backgrounds
- Light text
- Colorful accents
- Easy on the eyes

#### Corporate

- Professional colors
- Clean layout
- Clear hierarchy
- Trust-building design

#### Creative Design

- Bold colors
- Unique layouts
- Artistic elements
- Personal expression

### Color Palettes

#### Professional

- Primary: Navy blue (#1e3a8a)
- Secondary: Light gray (#f8fafc)
- Accent: Orange (#f59e0b)
- Text: Dark gray (#374151)

#### Creative Palette

- Primary: Purple (#7c3aed)
- Secondary: Pink (#ec4899)
- Accent: Yellow (#fbbf24)
- Background: Cream (#fefdf8)

#### Minimal

- Primary: Black (#000000)
- Secondary: White (#ffffff)
- Accent: Blue (#3b82f6)
- Text: Gray (#6b7280)

## Responsive Design

VibeLog automatically generates responsive designs, but you can fine-tune them:

### Breakpoints

```css
/* Mobile */
@media (max-width: 768px) {
  /* Mobile styles */
}

/* Tablet */
@media (min-width: 769px) and (max-width: 1024px) {
  /* Tablet styles */
}

/* Desktop */
@media (min-width: 1025px) {
  /* Desktop styles */
}
```

### Mobile-First Approach

Design for mobile first, then enhance for larger screens:

1. Start with mobile layout
2. Add tablet enhancements
3. Optimize for desktop
4. Test across devices

## Accessibility

Ensure your blog is accessible to all users:

### Color Contrast

- Use tools like WebAIM's contrast checker
- Maintain at least 4.5:1 contrast ratio for normal text
- Use 3:1 for large text (18pt+ or 14pt+ bold)

### Typography

- Use readable font sizes (16px minimum)
- Provide sufficient line spacing
- Choose accessible font families
- Avoid light gray text on light backgrounds

### Navigation

- Ensure keyboard navigation works
- Use semantic HTML elements
- Provide alt text for images
- Include skip links for screen readers

## Performance

Optimize your blog for fast loading:

### CSS Optimization

- Minimize unused CSS
- Use CSS variables for consistency
- Optimize for critical rendering path
- Consider CSS-in-JS for component styling

### Image Optimization

- Use appropriate image formats (WebP when possible)
- Implement responsive images
- Add proper alt text
- Consider lazy loading

## Troubleshooting

### Common Issues

1. **Styles Not Applying**: Clear browser cache and rebuild
2. **Mobile Layout Broken**: Check responsive breakpoints
3. **Colors Not Accessible**: Use contrast checking tools
4. **Fonts Not Loading**: Verify font imports and fallbacks
