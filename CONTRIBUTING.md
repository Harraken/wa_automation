# Contributing to WhatsApp Provisioner UI

Thank you for considering contributing to this project! 🎉

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Docker version, etc.)
- Logs/screenshots if applicable

### Suggesting Features

Feature requests are welcome! Please:
- Check if the feature is already requested
- Provide clear use case and benefit
- Be open to discussion and iteration

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/my-feature`
3. **Make your changes**
4. **Add tests** for new functionality
5. **Run tests**: `npm test`
6. **Lint your code**: `npm run lint`
7. **Commit** with clear message: `git commit -m "Add feature X"`
8. **Push**: `git push origin feature/my-feature`
9. **Open Pull Request** with description

### Code Style

- Follow existing patterns and conventions
- Use TypeScript strict mode
- Write JSDoc comments for public APIs
- Keep functions small and focused
- Use meaningful variable names

### Testing

- Write unit tests for utilities and services
- Write integration tests for API endpoints
- Maintain test coverage >80%
- Test edge cases and error paths

### Commit Messages

Use conventional commits format:
```
type(scope): subject

body (optional)

footer (optional)
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Example:
```
feat(provision): add retry logic for SMS polling

Implements exponential backoff with max 3 retries
when SMS-MAN API returns errors.

Closes #123
```

## Development Setup

See [README.md](README.md#development) for detailed setup instructions.

## Questions?

Feel free to open a discussion or reach out to maintainers.

Thank you for contributing! 🙏






