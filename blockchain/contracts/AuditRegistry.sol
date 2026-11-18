// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract AuditRegistry {
    struct Registration {
        address registrar;
        uint256 registeredAt;
    }

    address public immutable authorizedRegistrar;
    mapping(bytes32 => Registration) private registrations;

    error InvalidRegistrar();
    error Unauthorized();
    error InvalidHash();
    error AlreadyRegistered();

    event ReportRegistered(bytes32 indexed reportHash, address indexed registrar, uint256 registeredAt);

    constructor(address registrar) {
        if (registrar == address(0)) revert InvalidRegistrar();
        authorizedRegistrar = registrar;
    }

    function registerReport(bytes32 reportHash) external {
        if (msg.sender != authorizedRegistrar) revert Unauthorized();
        if (reportHash == bytes32(0)) revert InvalidHash();
        if (verifyReport(reportHash)) revert AlreadyRegistered();
        registrations[reportHash] = Registration(msg.sender, block.timestamp);
        emit ReportRegistered(reportHash, msg.sender, block.timestamp);
    }

    function verifyReport(bytes32 reportHash) public view returns (bool) {
        return registrations[reportHash].registrar != address(0);
    }

    function getRegistration(bytes32 reportHash)
        external view returns (bool exists, address registrar, uint256 registeredAt)
    {
        Registration memory registration = registrations[reportHash];
        return (registration.registrar != address(0), registration.registrar, registration.registeredAt);
    }
}
